import crypto from 'node:crypto'
import path from 'node:path'

/**
 * CLI entrypoint that keeps docs snippets warm.
 *
 * Workflow overview:
 *   1. Crawl doc sources for `?snippet` imports and resolve each entry file.
 *   2. Build a multi-file bundle per entry, render it through Expressive Code/Twoslash, and capture HTML + styles.
 *   3. Emit per-snippet artefacts and a manifest (including global styles/modules) into the cache directory.
 *
 * The pre-rendered output is consumed by Astro at build time so code examples render instantly without running
 * Twoslash in the browser.
 */

import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import type {
  Element as THastElement,
  ElementContent as THastElementContent,
  Parent as THastParent,
  RootContent as THastRootContent,
  Text as THastText,
} from 'hast'
import { toHtml } from 'hast-util-to-html'

import { defaultRebuildCommand, resolveProjectPaths, type TwoslashProjectPaths } from '../project-paths.ts'
import { buildSnippetBundle } from '../vite/snippet-graph.ts'

type THastRendererResult = {
  renderedGroupAst: THastElement
  styles: Set<string>
}

type TExpressiveRenderer = {
  ec: {
    render: (input: { code: string; language: string; meta?: string }) => Promise<THastRendererResult>
  }
  baseStyles: string
  themeStyles: string
  jsModules: string[]
}

const SNIPPET_IMPORT_REGEX = /['"]([^'"\n]+\?snippet[^'"]*)['"]/g
const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.astro', '.md', '.mdx', '.ts', '.mts', '.tsx', '.js', '.mjs', '.jsx'])
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', '.cache', 'dist', '.astro', '.netlify', 'logs'])

export class SnippetBuildError extends Schema.TaggedError<SnippetBuildError>()('SnippetBuildError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  entry: Schema.optional(Schema.String),
  importer: Schema.optional(Schema.String),
}) {}

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

/**
 * Returns the Twoslash language id inferred from a filename.
 * Falls back to the provided value or TypeScript when no extension can be resolved.
 */
const guessLanguage = (filename: string, fallback: string | undefined = undefined): string => {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension === undefined || extension.length === 0) return fallback ?? 'ts'
  if (extension === 'ts' || extension === 'cts' || extension === 'mts') return 'ts'
  if (extension === 'tsx') return 'tsx'
  if (extension === 'js' || extension === 'cjs' || extension === 'mjs') return 'js'
  if (extension === 'jsx') return 'jsx'
  if (extension === 'astro') return 'astro'
  if (extension === 'json') return 'json'
  if (extension === 'yaml' || extension === 'yml') return 'yaml'
  if (extension === 'css' || extension === 'scss') return 'css'
  if (extension === 'html') return 'html'
  if (extension === 'md' || extension === 'mdx') return 'md'
  if (extension === 'sh' || extension === 'bash') return 'bash'
  if (extension === 'vue') return 'vue'
  if (extension === 'txt') return 'plaintext'
  return extension
}

/**
 * Combines all virtual files of a bundle into a single Twoslash snippet string.
 * Ensures the focused file receives the `// ---cut---` marker so it appears first in the UI.
 */
const FILE_START_SENTINEL = '__LS_FILE_START__'
const FILE_END_SENTINEL = '__LS_FILE_END__'

const assembleSnippet = (files: Array<{ virtualPath: string; content: string }>, focusVirtualPath: string): string => {
  const segments: string[] = []
  const focusFile = files.find((file) => file.virtualPath === focusVirtualPath)

  if (focusFile) {
    segments.push(`// @filename: ${focusFile.virtualPath}`)
    segments.push(`// ${FILE_START_SENTINEL}:${focusFile.virtualPath}`)
    segments.push(focusFile.content)
    segments.push(`// ${FILE_END_SENTINEL}:${focusFile.virtualPath}`)
    segments.push('')
  }

  for (const file of files) {
    if (file.virtualPath === focusVirtualPath) continue
    segments.push(`// @filename: ${file.virtualPath}`)
    segments.push(`// ${FILE_START_SENTINEL}:${file.virtualPath}`)
    segments.push('// ---cut---')
    segments.push(file.content)
    segments.push(`// ${FILE_END_SENTINEL}:${file.virtualPath}`)
    segments.push('')
  }

  while (segments.length > 0 && segments[segments.length - 1] === '') {
    segments.pop()
  }

  const snippet = segments.join('\n')
  return snippet.endsWith('\n') ? snippet : `${snippet}\n`
}

const isElementNode = (node: THastElementContent | THastRootContent | undefined): node is THastElement =>
  Boolean(node && node.type === 'element')

const extractText = (node: THastElementContent | THastRootContent | null | undefined): string => {
  if (!node) return ''
  if (node.type === 'text') {
    return node.value ?? ''
  }
  if (node.type === 'comment') {
    return ''
  }
  if (Array.isArray((node as THastParent).children)) {
    return (node as THastParent).children
      .map((child) => extractText(child as THastElementContent | THastRootContent))
      .join('')
  }
  return ''
}

const findChildByTag = (parent: THastParent | null | undefined, tagName: string): THastElement | null => {
  if (!parent?.children) return null
  for (const child of parent.children) {
    if (isElementNode(child) && child.tagName === tagName) {
      return child
    }
  }
  return null
}

const trimRenderedAst = (root: THastElement, focusVirtualPath: string): THastElement => {
  const figure = findChildByTag(root as THastParent, 'figure')
  const pre = findChildByTag(figure, 'pre')
  const code = findChildByTag(pre, 'code')
  if (!code || !Array.isArray(code.children)) return root

  const focusName = path.posix.basename(focusVirtualPath)
  const focusRelative = focusVirtualPath
  const filtered: THastElement[] = []
  let currentFile: string | null = null

  for (const child of code.children) {
    if (!isElementNode(child)) {
      continue
    }
    const elementChild = child as THastElement
    if (elementChild.tagName !== 'div') {
      continue
    }
    const lineText = extractText(elementChild as THastElementContent).trim()
    const filenameMatch = lineText.match(/^\/\/\s*@filename:\s*(.+)$/)
    if (filenameMatch) {
      currentFile = filenameMatch[1]?.trim() ?? null
      continue
    }
    const fileStartMatch = lineText.match(/^\/\/\s*__LS_FILE_START__:(.+)$/)
    if (fileStartMatch) {
      currentFile = fileStartMatch[1]?.trim() ?? currentFile
      continue
    }
    const fileEndMatch = lineText.match(/^\/\/\s*__LS_FILE_END__:(.+)$/)
    if (fileEndMatch) {
      currentFile = null
      continue
    }
    if (currentFile === null) {
      continue
    }

    const belongsToFocus =
      currentFile === focusName ||
      currentFile === focusRelative ||
      currentFile === `./${focusName}` ||
      currentFile === `./${focusRelative}`

    if (belongsToFocus) {
      const textContent = lineText
      if (textContent.startsWith('/// <reference')) {
        continue
      }
      if (textContent.startsWith('// @filename:')) {
        continue
      }
      if (textContent.startsWith('// ---cut---')) {
        continue
      }
      if (textContent.startsWith('// __LS_FILE_START__') || textContent.startsWith('// __LS_FILE_END__')) {
        continue
      }
      filtered.push(elementChild)
    }
  }

  if (filtered.length === 0) {
    return root
  }

  code.children = filtered

  const figcaption = findChildByTag(figure, 'figcaption')
  const titleContainer = findChildByTag(figcaption, 'span')
  if (titleContainer && Array.isArray(titleContainer.children)) {
    const textNode = titleContainer.children.find((child) => (child as THastText).type === 'text') as
      | THastText
      | undefined
    if (textNode) {
      textNode.value = focusName
    }
  }

  return root
}

/**
 * Recursively collects documentation source files that may contain `?snippet` imports.
 * Directories in the exclusion list (node_modules, build artefacts, etc.) are skipped.
 */
const collectSourceFiles = (
  fs: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<readonly string[], SnippetBuildError> =>
  Effect.gen(function* () {
    const entries = yield* fs.readDirectory(directory)
    const files: string[] = []

    for (const name of entries) {
      if (EXCLUDED_DIRECTORIES.has(name)) continue
      if (name.startsWith('.')) {
        if (!(name === '.gitignore' || name === '.eslintrc' || name === '.prettierrc')) continue
      }

      const fullPath = path.join(directory, name)
      const info = yield* fs.stat(fullPath)

      if (info.type === 'Directory') {
        const nested = yield* collectSourceFiles(fs, fullPath)
        files.push(...nested)
        continue
      }

      if (info.type !== 'File') continue

      if (!SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(name))) continue
      files.push(fullPath)
    }

    return files
  }).pipe(
    Effect.mapError((cause) => new SnippetBuildError({ message: `Failed to scan directory: ${directory}`, cause })),
  )

type TSnippetEntry = {
  entryPath: string
  importers: readonly string[]
}

/**
 * Parses all documentation sources and returns the set of snippet entrypoints.
 * Each entry retains the list of files that import it, which is useful for diagnostics.
 */
const collectSnippetEntries = (
  fs: FileSystem.FileSystem,
  files: readonly string[],
): Effect.Effect<readonly TSnippetEntry[], SnippetBuildError> =>
  Effect.gen(function* () {
    const entries = new Map<string, { entryPath: string; importers: Set<string> }>()

    for (const filePath of files) {
      const source = yield* fs
        .readFileString(filePath)
        .pipe(Effect.mapError((cause) => new SnippetBuildError({ message: `Unable to read ${filePath}`, cause })))

      const dir = path.dirname(filePath)
      let match: RegExpExecArray | null = SNIPPET_IMPORT_REGEX.exec(source)
      while (match !== null) {
        const specifier = match[1]
        if (typeof specifier !== 'string') {
          match = SNIPPET_IMPORT_REGEX.exec(source)
          continue
        }
        const [rawPath] = specifier.split('?')
        if (!rawPath || !(rawPath.startsWith('./') || rawPath.startsWith('../'))) {
          match = SNIPPET_IMPORT_REGEX.exec(source)
          continue
        }

        const resolved = path.resolve(dir, rawPath)
        const exists = yield* fs
          .exists(resolved)
          .pipe(Effect.mapError((cause) => new SnippetBuildError({ message: `Failed to resolve ${resolved}`, cause })))
        if (!exists) {
          match = SNIPPET_IMPORT_REGEX.exec(source)
          continue
        }

        const record = entries.get(resolved)
        if (record) {
          record.importers.add(filePath)
        } else {
          entries.set(resolved, { entryPath: resolved, importers: new Set([filePath]) })
        }

        match = SNIPPET_IMPORT_REGEX.exec(source)
      }
      SNIPPET_IMPORT_REGEX.lastIndex = 0
    }

    return Array.from(entries.values()).map(({ entryPath, importers }) => ({
      entryPath,
      importers: Array.from(importers).sort(),
    }))
  })

/**
 * Dynamically loads the Expressive Code/Twoslash renderer using the docs configuration.
 * This keeps the CLI aligned with the runtime renderer without duplicating config state.
 */
const loadEcRenderer = (paths: TwoslashProjectPaths): Effect.Effect<TExpressiveRenderer, SnippetBuildError> =>
  Effect.tryPromise({
    try: async () => {
      const configModule = await import(paths.ecConfigPath)
      const config = configModule.default
      const astroExpressiveCodeModule = await import(
        path.join(paths.projectRoot, 'node_modules/astro-expressive-code/dist/index.js')
      )
      const renderer = await astroExpressiveCodeModule.createRenderer(config)
      return renderer as TExpressiveRenderer
    },
    catch: (cause) => new SnippetBuildError({ message: 'Unable to load Expressive Code renderer', cause }),
  })

type TRenderedSnippet = {
  filename: string
  html: string | null
  language: string
  meta: string
  diagnostics: string[]
  styles: string[]
}

type TSnippetArtifact = {
  version: 1
  entryFile: string
  mainFilename: string
  bundleHash: string
  generatedAt: string
  files: readonly {
    filename: string
    content: string
    isMain: boolean
    hash: string
  }[]
  rendered: readonly TRenderedSnippet[]
}

type TSnippetManifest = {
  version: 1
  generatedAt: string
  configHash: string
  baseStyles: string
  themeStyles: string
  jsModules: readonly string[]
  entries: readonly {
    entryFile: string
    mainFilename: string
    artifactPath: string
    bundleHash: string
  }[]
}

/**
 * Renders a snippet bundle to HTML via Expressive Code.
 * Twoslash failures now raise a `SnippetBuildError` so the CLI halts instead of emitting incomplete artefacts.
 */
const renderSnippet = (
  renderer: TExpressiveRenderer,
  bundle: ReturnType<typeof buildSnippetBundle>,
  focusFilename: string,
): Effect.Effect<TRenderedSnippet, SnippetBuildError> =>
  Effect.tryPromise({
    try: async () => {
      const virtualFiles = bundle.files.map((file) => {
        const virtualPath =
          file.relativePath.length > 0 ? `./${file.relativePath}` : path.posix.basename(file.relativePath)
        const normalizedVirtual = virtualPath.length > 0 ? virtualPath : './index.ts'
        const sanitizedContent = file.content.replace(/^\s*\/\/\/\s*<reference[^\n]*\n?/g, '')
        return {
          ...file,
          content: sanitizedContent,
          virtualPath: normalizedVirtual,
        }
      })

      const focusVirtualPath =
        virtualFiles.find((file) => file.relativePath === focusFilename)?.virtualPath ??
        virtualFiles[0]?.virtualPath ??
        focusFilename

      const snippet = assembleSnippet(
        virtualFiles.map((file) => ({ virtualPath: file.virtualPath, content: file.content })),
        focusVirtualPath,
      )
      const language = guessLanguage(focusFilename)
      let html: string | null = null
      let styles: string[] = []
      let renderResult: THastRendererResult
      try {
        renderResult = await renderer.ec.render({ code: snippet, language, meta: 'twoslash' })
      } catch (cause) {
        const failure = cause as { message?: string; cause?: unknown }
        const nested = failure?.cause as { recommendation?: string; message?: string } | undefined
        const detail = nested?.recommendation ?? nested?.message ?? failure?.message ?? null
        const message =
          detail != null && detail.length > 0
            ? `Twoslash rendering failed for ${focusFilename}: ${detail}`
            : `Twoslash rendering failed for ${focusFilename}`
        throw new SnippetBuildError({
          message,
          cause,
          entry: bundle.entryFilePath,
        })
      }

      const trimmedAst = trimRenderedAst(renderResult.renderedGroupAst, focusVirtualPath)
      html = toHtml(trimmedAst)
      styles = Array.from(renderResult.styles)
      return {
        filename: focusFilename,
        html,
        language,
        meta: 'twoslash',
        diagnostics: [],
        styles,
      } satisfies TRenderedSnippet
    },
    catch: (cause) =>
      cause instanceof SnippetBuildError
        ? cause
        : new SnippetBuildError({
            message: `Failed to render snippet for ${focusFilename}`,
            cause,
            entry: bundle.entryFilePath,
          }),
  })

export type BuildSnippetsOptions = {
  projectRoot?: string
  rebuildCommand?: string
}

type ResolvedBuildOptions = {
  paths: TwoslashProjectPaths
  rebuildCommand: string
}

const resolveOptions = (options: BuildSnippetsOptions = {}): ResolvedBuildOptions => {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd()
  const rebuildCommand = options.rebuildCommand ?? defaultRebuildCommand
  return {
    paths: resolveProjectPaths(projectRoot),
    rebuildCommand,
  }
}

/**
 * CLI entry-point that pre-renders all snippet bundles and emits artefacts + manifest.
 * This command runs before `mono docs build` to guarantee cached HTML is available during Astro builds.
 */
const buildSnippetsInternal = ({ paths }: ResolvedBuildOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    yield* fs.makeDirectory(paths.cacheRoot, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new SnippetBuildError({
            message: `Failed to ensure cache directory: ${paths.cacheRoot}`,
            cause,
          }),
      ),
    )

    const sourceFiles = yield* collectSourceFiles(fs, paths.srcRoot)
    const snippetEntries = yield* collectSnippetEntries(fs, sourceFiles)

    if (snippetEntries.length === 0) {
      yield* Effect.log('No ?snippet imports found in docs source')
      return
    }

    const renderer = yield* loadEcRenderer(paths)

    const artifactEntries: Array<TSnippetManifest['entries'][number]> = []

    for (const entry of snippetEntries) {
      const bundle = buildSnippetBundle({ entryFilePath: entry.entryPath, baseDir: paths.snippetAssetsRoot })

      const filesWithHash = bundle.files.map((file, index) => ({
        filename: file.relativePath,
        content: file.content,
        isMain: index === 0,
        hash: hashString(file.content),
      }))

      const renderedSnippets: TRenderedSnippet[] = []
      for (const file of bundle.files) {
        const rendered = yield* renderSnippet(renderer, bundle, file.relativePath)
        if (rendered.html === null && rendered.diagnostics.length > 0) {
          yield* Effect.logWarning(`Twoslash pre-rendering skipped for ${entry.entryPath}: ${rendered.diagnostics[0]}`)
        }
        renderedSnippets.push(rendered)
      }

      const bundleHash = hashString(
        JSON.stringify({
          files: filesWithHash.map((file) => ({ filename: file.filename, hash: file.hash })),
          meta: 'twoslash',
        }),
      )

      const artifact: TSnippetArtifact = {
        version: 1,
        entryFile: path.relative(paths.snippetAssetsRoot, bundle.entryFilePath).replace(/\\/g, '/'),
        mainFilename: bundle.mainFileRelativePath,
        bundleHash,
        generatedAt: new Date().toISOString(),
        files: filesWithHash,
        rendered: renderedSnippets,
      }

      const artifactPath = path.join(paths.cacheRoot, `${bundle.mainFileRelativePath}.json`)
      yield* fs
        .makeDirectory(path.dirname(artifactPath), { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) => new SnippetBuildError({ message: `Failed to create cache path for ${artifactPath}`, cause }),
          ),
        )

      yield* fs
        .writeFileString(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`)
        .pipe(
          Effect.mapError(
            (cause) => new SnippetBuildError({ message: `Unable to write artifact ${artifactPath}`, cause }),
          ),
        )

      artifactEntries.push({
        entryFile: artifact.entryFile,
        mainFilename: artifact.mainFilename,
        artifactPath: path.relative(paths.cacheRoot, artifactPath).replace(/\\/g, '/'),
        bundleHash: artifact.bundleHash,
      })
    }

    const ecConfigSource = yield* fs
      .readFileString(paths.ecConfigPath)
      .pipe(Effect.mapError((cause) => new SnippetBuildError({ message: 'Failed to read ec.config.mjs', cause })))

    const manifest: TSnippetManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      configHash: hashString(ecConfigSource),
      baseStyles: renderer.baseStyles,
      themeStyles: renderer.themeStyles,
      jsModules: renderer.jsModules,
      entries: artifactEntries,
    }

    yield* fs
      .writeFileString(path.join(paths.cacheRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      .pipe(Effect.mapError((cause) => new SnippetBuildError({ message: 'Unable to write snippets manifest', cause })))

    yield* Effect.log(`Rendered ${artifactEntries.length} snippet bundles`)
  })

const normalizeOptions = (options: BuildSnippetsOptions = {}): BuildSnippetsOptions => {
  const normalized: BuildSnippetsOptions = {}
  if (options.projectRoot !== undefined) {
    normalized.projectRoot = options.projectRoot
  }
  if (options.rebuildCommand !== undefined) {
    normalized.rebuildCommand = options.rebuildCommand
  }
  return normalized
}

export const buildSnippets = (options: BuildSnippetsOptions = {}) => {
  const resolved = resolveOptions(normalizeOptions(options))
  return Effect.withSpan('astro-twoslash-code/build-snippets')(buildSnippetsInternal(resolved))
}

export type CreateSnippetsCommandOptions = BuildSnippetsOptions & {
  commandName?: string
}

export const createSnippetsCommand = ({
  projectRoot,
  rebuildCommand,
  commandName = 'snippets',
}: CreateSnippetsCommandOptions = {}) => {
  const resolved = resolveOptions(
    normalizeOptions({
      ...(projectRoot !== undefined ? { projectRoot } : {}),
      ...(rebuildCommand !== undefined ? { rebuildCommand } : {}),
    }),
  )

  const buildHandler = Effect.withSpan('astro-twoslash-code/cli/snippets-build')(buildSnippetsInternal(resolved))

  const buildCommand = Cli.Command.make('build', {}, () => buildHandler)

  return Cli.Command.make(commandName).pipe(Cli.Command.withSubcommands([buildCommand]))
}
