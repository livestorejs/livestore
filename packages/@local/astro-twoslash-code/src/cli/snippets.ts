import crypto from 'node:crypto'
import path from 'node:path'

import * as astroExpressiveCodeModuleStatic from 'astro-expressive-code'
/**
 * Astro-Twoslash-Code snippets virtual-filesystem specification
 *
 * Why this exists
 * ----------------
 *   Docs authors scatter runnable examples across `docs/src/content/_assets/code/**` and
 *   reference them via `?snippet` imports.  At build time we have to aggregate those loose
 *   files, give Twoslash a coherent (TypeScript-compatible) virtual filesystem, and then ship
 *   pre-rendered artefacts plus a manifest that Astro can hydrate.  The machinery below is the
 *   canonical description of how physical files are converted into virtual paths, how we guard
 *   against ambiguous aliases, and which invariants consumers can rely on.
 *
 * Source directory model
 * ----------------------
 *   - `resolveProjectPaths(projectRoot)` anchors every run in a single snippet root
 *     (`{projectRoot}/src/content/_assets/code`).  All bundle operations happen inside this root.
 *   - `buildSnippetBundle` follows relative `./` and `../` imports.  Anything outside the snippet
 *     root is intentionally ignored; authors must copy supporting files into the docs repo.
 *   - Triple-slash references are stripped (`sanitizeSnippetContent`) so that Twoslash does not
 *     accidentally traverse "real" project dependencies.
 *
 * Canonical virtual paths
 * -----------------------
 *   - Every collected file receives a canonical virtual path that mirrors its relative path from
 *     the snippet root (e.g. `reference/solid-integration/livestore/schema.ts →
 *     ./reference/solid-integration/livestore/schema.ts`).  Dot-segments are collapsed, but parent
 *     traversals are preserved to keep cross-directory references resolvable.
 *   - We record these canonical paths once per file.  Duplicates (such as `./schema.ts` and
 *     `./reference/.../schema.ts`) are not emitted because TypeScript would otherwise drop the
 *     duplicate from program state, leading to the "Cannot find module" errors that motivated this
 *     rewrite.
 *
 * Specifier rewrites & focus handling
 * -----------------------------------
 *   - `normalizeRelativeSpecifiers` walks each file, captures the author-written specifier
 *     (`raw`), normalises it relative to the source file (`normalized`), and resolves a canonical
 *     target (`canonical`).  This table is the ground truth for later transformations.
 *   - When we render a focus file, its content is rewritten to canonical specifiers only for the
 *     Twoslash compilation (`focusTwoslashContent`).  Supporting files retain their canonical
 *     source unchanged, ensuring a stable view of the module graph.
 *   - `assembleSnippet` prefixes every virtual file with ownership sentinels (`// __LS_FILE_START__` /
 *     `// __LS_FILE_END__`).  The focus file is concatenated after the supporting files so the
 *     markers always appear, even when Expressive Code reorders blocks during rendering.
 *   - After Twoslash finishes, we trim the rendered AST to the focus segment, strip all sentinel
 *     lines from the HTML and copy payloads, and `restoreFocusSpecifiers` walks the AST to swap the
 *     canonical strings back to the author-written forms so the docs match the prose.
 *
 * Artefact manifest contract
 * --------------------------
 *   - Each snippet bundle yields a JSON artefact stored under
 *     `{projectRoot}/.cache/snippets/<main-file>.json`.  The payload lists:
 *       * `files`: hashed source files with their relative (on-disk) paths.
 *       * `rendered`: per-file HTML/diagnostics keyed by the original relative filename.
 *   - The manifest (`.cache/snippets/manifest.json`) aggregates bundle hashes and the renderer
 *     assets (base styles, theme styles, JS modules).  Astro consumes this manifest to inline
 *     static assets without re-running Twoslash.
 *
 * Design decisions & unsupported patterns
 * ---------------------------------------
 *   - One bundle ↔ one authoritative path per file.  We deliberately avoid alias files or
 *     duplicate `// @filename` sections; doing so keeps TypeScript's incremental compiler stable.
 *   - Import specifiers must remain relative (`./` or `../`).  Absolute, package-based, or runtime
 *     dynamic imports are rejected by the crawler and therefore unsupported.
 *   - References that escape the snippet root (`../..`) are normalised but still trimmed to their
 *     canonical representation; if the resolved file lives outside the root it is skipped.  This
 *     prevents unintentional leakage of monorepo sources into the docs build.
 *   - Worker query parameters (`?worker`, `?sharedworker`) and similar suffixes are preserved.  We
 *     treat everything after `?`/`#` as a transparent suffix when rewriting specifiers.
 *   - The tooling assumes NodeNext-style resolution with explicit extensions.  Files without an
 *     extension or specifiers resolved via index files are not supported.
 *
 * This comment is the authoritative spec for the path handling layer—keep it in sync with any
 * behavioural changes so downstream consumers understand the guarantees they receive.  If you touch
 * any code in this module, update this spec first; drift here will guarantee regressions the next
 * time someone tweaks Twoslash or the docs build.
 */

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
} from 'hast'
import { toHtml } from 'hast-util-to-html'

import { createExpressiveCodeConfig, normalizeRuntimeOptions, type TwoslashRuntimeOptions } from '../expressive-code.ts'
import { resolveProjectPaths, type TwoslashProjectPaths } from '../project-paths.ts'
import type { SnippetBundle } from '../vite/snippet-graph.ts'
import { buildSnippetBundle, __internal as snippetGraphInternal } from '../vite/snippet-graph.ts'

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
 * Combines all virtual files of a bundle into a single Twoslash snippet string while
 * retaining ownership metadata for every line. Twoslash still receives a concatenated
 * snippet, but callers can later recover the focus-only section without relying on
 * heuristics from the rendered HTML.
 */

type SnippetLine = {
  content: string
  owner: string | null
}

type AssembledSnippet = {
  code: string
  lines: SnippetLine[]
}

const assembleSnippet = (
  files: Array<{ virtualPath: string; content: string }>,
  focusVirtualPath: string,
): AssembledSnippet => {
  const focusLines: SnippetLine[] = []
  const supportLines: SnippetLine[] = []

  const pushLines = (target: SnippetLine[], block: string, owner: string, onAfterPush?: (line: string) => void) => {
    const normalized = block.replace(/\r?\n/g, '\n')
    const parts = normalized.split('\n')
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!
      target.push({ content: part, owner })
      onAfterPush?.(part)
    }
  }

  const appendBlankLine = (target: SnippetLine[]) => {
    target.push({ content: '', owner: null })
  }

  for (const file of files) {
    const owner = file.virtualPath
    if (owner === focusVirtualPath) {
      const insertStartSentinel = () => {
        focusLines.push({ content: `// __LS_FILE_START__:${owner}`, owner: null })
      }
      focusLines.push({ content: `// @filename: ${owner}`, owner: null })
      insertStartSentinel()
      pushLines(focusLines, file.content, owner, (line) => {
        if (line.trimStart().startsWith('// ---cut')) {
          insertStartSentinel()
        }
      })
      focusLines.push({ content: `// __LS_FILE_END__:${owner}`, owner: null })
      appendBlankLine(focusLines)
      continue
    }

    const insertSupportStartSentinel = () => {
      supportLines.push({ content: `// __LS_FILE_START__:${owner}`, owner: null })
    }
    supportLines.push({ content: `// @filename: ${owner}`, owner: null })
    insertSupportStartSentinel()
    pushLines(supportLines, file.content, owner, (line) => {
      if (line.trimStart().startsWith('// ---cut')) {
        insertSupportStartSentinel()
      }
    })
    supportLines.push({ content: `// __LS_FILE_END__:${owner}`, owner: null })
    appendBlankLine(supportLines)
  }

  const lines = [...focusLines, ...supportLines]
  while (lines.length > 0 && lines[lines.length - 1]?.content === '') {
    lines.pop()
  }

  const code = lines.map((line) => line.content).join('\n')
  return {
    code: code.endsWith('\n') ? code : `${code}\n`,
    lines,
  }
}

const sanitizeSnippetContent = (content: string): string => content.replace(/^\s*\/\/\/\s*<reference[^\n]*\n?/g, '')

/**
 * Establishes canonical snippet filenames that mirror the on-disk structure.
 *
 * Why: Twoslash spins up a TypeScript program from our virtual file set. When
 * multiple aliases point at the same file (e.g. `./schema.ts` and
 * `./reference/.../schema.ts`) the compiler silently drops the duplicate, which
 * is exactly what triggered the missing-module diagnostics. Canonicalising here
 * gives us a single authoritative path that can be swapped in/out per focus
 * file while keeping the rest of the graph stable.
 */
const canonicalizeDisplayPath = (relativePath: string, fallback: string): string => {
  if (relativePath.length === 0) return fallback
  const normalized = path.posix.normalize(relativePath)
  if (normalized === '.' || normalized.length === 0) return fallback
  return normalized
}

const canonicalizeVirtualPath = (displayPath: string): string =>
  displayPath.startsWith('.') ? displayPath : `./${displayPath}`

type TVirtualFileRecord = SnippetBundle['files'][number] & {
  virtualPath: string
  canonicalVirtualPath: string
  displayPath: string
  content: string
  canonicalContent: string
  focusContent: string
  focusTwoslashContent: string
  relativeImports: readonly {
    raw: string
    normalized: string
    canonical: string
  }[]
}

const splitImportSpecifier = (specifier: string): { pathPart: string; suffix: string } => {
  const queryIndex = specifier.indexOf('?')
  const hashIndex = specifier.indexOf('#')
  const cutIndex =
    queryIndex >= 0 && hashIndex >= 0 ? Math.min(queryIndex, hashIndex) : queryIndex >= 0 ? queryIndex : hashIndex
  if (cutIndex === -1) {
    return { pathPart: specifier, suffix: '' }
  }
  return {
    pathPart: specifier.slice(0, cutIndex),
    suffix: specifier.slice(cutIndex),
  }
}

const replaceRelativeSpecifier = (source: string, from: string, to: string): string => {
  if (from === to) {
    return source
  }

  const patterns: Array<[string, string]> = [
    [`'${from}'`, `'${to}'`],
    [`"${from}"`, `"${to}"`],
    [`\`${from}\``, `\`${to}\``],
    [`path="${from}"`, `path="${to}"`],
    [`path='${from}'`, `path='${to}'`],
  ]

  let rewritten = source
  for (const [needle, replacement] of patterns) {
    if (rewritten.includes(needle)) {
      rewritten = rewritten.replaceAll(needle, replacement)
    }
  }
  return rewritten
}

type Mutable<T> = {
  -readonly [P in keyof T]: Mutable<T[P]>
}

/**
 * Computes the mapping between the import specifiers a doc author wrote and the
 * canonical paths Twoslash needs to compile the bundle.
 *
 * Why: Every focus file should retain human-friendly imports (`./schema.ts`),
 * but Twoslash requires canonical locations so the entire snippet graph shares
 * a coherent module namespace. Capturing both forms lets us hand the canonical
 * variants to Twoslash for type-checking and later restore the originals for the
 * rendered output.
 */
const normalizeRelativeSpecifiers = (
  content: string,
  fileRelativePath: string,
  canonicalMap: Map<string, string>,
): { content: string; rewrites: TVirtualFileRecord['relativeImports'] } => {
  let rewritten = content
  const rewrites: Mutable<TVirtualFileRecord['relativeImports']> = []

  for (const specifier of snippetGraphInternal.extractRelativeImports(content)) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
    const { pathPart, suffix } = splitImportSpecifier(specifier)
    const fromDir = path.posix.dirname(fileRelativePath)
    const resolved = path.posix.normalize(path.posix.join(fromDir, pathPart))

    let relativeSpecifier = path.posix.relative(fromDir, resolved)
    if (relativeSpecifier.length === 0 || relativeSpecifier === '.') {
      relativeSpecifier = `./${path.posix.basename(resolved)}`
    } else if (!relativeSpecifier.startsWith('./') && !relativeSpecifier.startsWith('../')) {
      relativeSpecifier = `./${relativeSpecifier}`
    }

    const normalizedSpecifier = `${relativeSpecifier}${suffix}`
    rewritten = replaceRelativeSpecifier(rewritten, specifier, normalizedSpecifier)

    const canonicalVirtual = canonicalMap.get(resolved) ?? canonicalizeVirtualPath(resolved)
    const canonicalSpecifier = `${canonicalVirtual}${suffix}`
    rewrites.push({ raw: specifier, normalized: normalizedSpecifier, canonical: canonicalSpecifier })
  }

  return { content: rewritten, rewrites }
}

const applySpecifierRewrites = (
  content: string,
  rewrites: TVirtualFileRecord['relativeImports'],
  from: 'raw' | 'normalized' | 'canonical',
  to: 'raw' | 'normalized' | 'canonical',
): string => {
  let output = content

  for (const rewrite of rewrites) {
    const source = rewrite[from]
    const target = rewrite[to]
    if (source === target) {
      continue
    }
    output = replaceRelativeSpecifier(output, source, target)
  }

  return output
}

const createVirtualFiles = (files: SnippetBundle['files'], fileOrder: readonly string[]): TVirtualFileRecord[] => {
  const records = fileOrder.map((filename) => {
    const file = files[filename]
    if (!file) {
      throw new Error(`createVirtualFiles: missing file record for ${filename}`)
    }
    const fallbackName = path.posix.basename(file.absolutePath) || 'index.ts'
    const displayPath = canonicalizeDisplayPath(file.relativePath, fallbackName)
    const canonicalVirtualPath = canonicalizeVirtualPath(displayPath)
    const sanitizedContent = sanitizeSnippetContent(file.content)

    return {
      ...file,
      virtualPath: canonicalVirtualPath,
      canonicalVirtualPath,
      displayPath,
      canonicalContent: sanitizedContent,
      focusContent: sanitizedContent,
      content: sanitizedContent,
    }
  })

  const canonicalMap = new Map<string, string>(
    records.map((record) => [record.relativePath, record.canonicalVirtualPath]),
  )

  return records.map((record) => {
    const { content: canonicalContent, rewrites } = normalizeRelativeSpecifiers(
      record.canonicalContent,
      record.relativePath,
      canonicalMap,
    )

    return {
      ...record,
      canonicalContent,
      content: canonicalContent,
      focusTwoslashContent: applySpecifierRewrites(record.focusContent, rewrites, 'raw', 'canonical'),
      relativeImports: rewrites,
    }
  })
}

/**
 * Builds the per-focus virtual file list passed into Twoslash.
 *
 * Why: Twoslash expects canonical import specifiers during compilation. Only the
 * focus file temporarily receives the canonicalised content (so the compiler can
 * resolve its dependencies), while supporting files stay untouched. That keeps
 * the virtual file identity stable while avoiding duplicate `// @filename`
 * blocks for the same module.
 */
const remapVirtualPathsForFocus = (files: TVirtualFileRecord[], focusFilename: string): TVirtualFileRecord[] => {
  const normalizedFocus = path.posix.normalize(focusFilename)

  return files.map((file) => {
    const isFocus = file.relativePath === normalizedFocus

    return {
      ...file,
      virtualPath: file.canonicalVirtualPath,
      content: isFocus ? file.focusTwoslashContent : file.canonicalContent,
    }
  })
}

const resolveFocusVirtualPath = (virtualFiles: TVirtualFileRecord[], focusFilename: string): string =>
  virtualFiles.find((file) => file.relativePath === focusFilename)?.virtualPath ??
  virtualFiles[0]?.virtualPath ??
  focusFilename

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

/**
 * Helper for walking the HAST emitted by Expressive Code. We only care about a
 * couple of wrapper nodes (figure/pre/code), so a shallow scan is sufficient.
 */
const findChildByTag = (parent: THastParent | null | undefined, tagName: string): THastElement | null => {
  if (!parent?.children) return null
  for (const child of parent.children) {
    if (isElementNode(child) && child.tagName === tagName) {
      return child
    }
  }
  return null
}

const toClassList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => toClassList(item))
  }
  if (typeof value === 'string') {
    return value.split(/\s+/).filter((item) => item.length > 0)
  }
  return []
}

const collectDiagnostics = (node: THastElement): string[] => {
  const diagnostics: string[] = []

  const walk = (current: THastElementContent | THastRootContent | undefined) => {
    if (!isElementNode(current)) return

    const element = current as THastElement
    const classList = toClassList(element.properties?.className)
    if (classList.includes('twoslash-error-box-content-message')) {
      const message = extractText(element).trim()
      if (message.length > 0) {
        diagnostics.push(message)
      }
    }

    if (Array.isArray(element.children)) {
      for (const child of element.children) {
        walk(child as THastElementContent | THastRootContent)
      }
    }
  }

  walk(node as unknown as THastElementContent)
  return diagnostics
}

const normalizeSnippetPath = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return trimmed
  const normalized = path.posix.normalize(trimmed)
  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    return normalized
  }
  return `./${normalized}`
}

const stripSnippetSentinels = (value: string): string => {
  const normalised = value.replace(/\u007f/g, '\n')
  const cleanedLines: string[] = []

  /**
   * Preserve author-formatted blank lines while removing Twoslash sentinels that leak into the markup.
   * Sentinel-only rows are dropped entirely so they don't introduce synthetic whitespace artifacts.
   */
  for (const line of normalised.split(/\r?\n/)) {
    let current = line
    const trimmed = current.trimStart()
    if (trimmed.startsWith('// @filename:')) {
      continue
    }
    if (trimmed.startsWith('// ---cut---')) {
      continue
    }
    const beforeStart = current
    current = current.replace(/^\s*\/\/ __LS_FILE_START__:[^\s]+\s*/, '')
    const removedStart = beforeStart !== current
    const beforeEnd = current
    current = current.replace(/^\s*\/\/ __LS_FILE_END__:[^\s]+\s*/, '')
    const removedEnd = beforeEnd !== current
    if ((removedStart || removedEnd) && current.trim().length === 0) {
      continue
    }
    cleanedLines.push(current)
  }

  // Remove trailing whitespace-only rows while keeping interior blank lines intact.
  let end = cleanedLines.length
  while (end > 0 && cleanedLines[end - 1]?.trim().length === 0) {
    end -= 1
  }

  return cleanedLines.slice(0, end).join('\n')
}

const stripSentinelsFromDataCodeAttributes = (html: string): string =>
  html.replace(/(data-code=")([^"]*)("|$)/g, (_match, prefix, value, suffix) => {
    const cleaned = stripSnippetSentinels(value)
    const restored = cleaned.replace(/\n/g, '\u007f')
    return `${prefix}${restored}${suffix}`
  })

const extractCanonicalOwner = (raw: string | null | undefined): string | null => {
  if (typeof raw !== 'string') return null
  const [token] = raw.trim().split(/\s+/, 1)
  if (!token) return null
  return normalizeSnippetPath(token)
}

const trimRenderedAst = (root: THastElement, focusVirtualPath: string, assembled: AssembledSnippet): THastElement => {
  const figure = findChildByTag(root as THastParent, 'figure')
  const pre = findChildByTag(figure, 'pre')
  const code = findChildByTag(pre, 'code')
  if (!code || !Array.isArray(code.children)) return root

  const canonicalFocus = extractCanonicalOwner(focusVirtualPath) ?? normalizeSnippetPath(focusVirtualPath)
  const focusName = path.posix.basename(canonicalFocus)
  const focusMarkers = new Set<string>([canonicalFocus, normalizeSnippetPath(focusName), focusName])

  const filtered: THastElement[] = []
  let includeFocus = false

  // Preserve blank lines inside the focus file while we iterate; we'll drop trailing empties afterwards.
  for (const child of code.children) {
    if (!isElementNode(child)) continue
    if ((child as THastElement).tagName !== 'div') continue

    const rawText = extractText(child as THastElementContent)
    const text = rawText.trim()
    if (text.length === 0) {
      if (!includeFocus) continue
      filtered.push(child as THastElement)
      continue
    }
    const startMatch = text.match(/__LS_FILE_START__:(.+)$/)
    if (startMatch) {
      const owner = extractCanonicalOwner(startMatch[1])
      includeFocus = owner !== null && focusMarkers.has(owner)
      continue
    }

    const endMatch = text.match(/__LS_FILE_END__:(.+)$/)
    if (endMatch) {
      const owner = extractCanonicalOwner(endMatch[1])
      if (owner !== null && focusMarkers.has(owner)) {
        includeFocus = false
      }
      continue
    }

    if (text.startsWith('// @filename:')) continue
    if (text.startsWith('// ---cut---')) continue
    if (text.startsWith('/// <reference') || text.startsWith('/// &lt;reference')) continue
    if (text.includes('__LS_FILE_START__') || text.includes('__LS_FILE_END__')) continue
    if (!includeFocus) continue

    filtered.push(child as THastElement)
  }

  while (filtered.length > 0) {
    const last = filtered[filtered.length - 1]!
    if (extractText(last as THastElementContent).trim().length === 0) {
      filtered.pop()
      continue
    }
    break
  }

  if (filtered.length === 0) {
    return root
  }

  code.children = filtered

  const figcaption = findChildByTag(figure, 'figcaption')
  if (figure && Array.isArray((figure as THastParent).children) && figcaption) {
    ;(figure as THastParent).children = (figure as THastParent).children.filter((child) => child !== figcaption)
  }

  const copyElement =
    figure && Array.isArray((figure as THastParent).children)
      ? (figure as THastParent).children.find((child) => {
          if (!isElementNode(child)) return false
          if (child.tagName !== 'div') return false
          return toClassList((child as THastElement).properties?.className).includes('copy')
        })
      : null

  if (copyElement && isElementNode(copyElement) && Array.isArray((copyElement as THastParent).children)) {
    for (const node of (copyElement as THastParent).children) {
      if (!isElementNode(node)) continue
      if (node.tagName !== 'button') continue
      const properties = node.properties ?? {}
      const trimmedSource = assembled.lines
        .filter((line) => line.owner === canonicalFocus)
        .map((line) => line.content)
        .join('\n')
      const sanitizedDataCode = stripSnippetSentinels(trimmedSource)
      delete properties['data-code']
      properties.dataCode = sanitizedDataCode
    }
  }

  if (figure && Array.isArray((figure as THastParent).children)) {
    const retainedChildren: Array<THastElementContent> = []
    if (pre) retainedChildren.push(pre as unknown as THastElementContent)
    if (copyElement && isElementNode(copyElement)) {
      retainedChildren.push(copyElement as THastElementContent)
    }
    ;(figure as THastParent).children = retainedChildren
  }

  return root
}

/**
 * Restores the author-written specifiers inside the rendered AST so the docs
 the author-written specifiers inside the rendered AST so the docs
 * show the paths people expect.
 *
 * Why: The snippet fed into Twoslash uses canonical specifiers to make the
 * compiler happy. Without restoring the original strings the published docs
 * would leak those canonical paths (`./reference/...`), which is confusing and
 * contradicts the examples in the prose. Walking the AST keeps the hydration
 * metadata intact while swapping the readable import names back in.
 */
const restoreFocusSpecifiers = (root: THastElement, rewrites: TVirtualFileRecord['relativeImports']): THastElement => {
  const replacements = rewrites.filter((rewrite) => rewrite.canonical !== rewrite.raw)
  if (replacements.length === 0) {
    return root
  }

  const replaceValue = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || value.length === 0) {
      return typeof value === 'string' ? value : undefined
    }
    let current = value
    for (const rewrite of replacements) {
      if (current.includes(rewrite.canonical)) {
        current = current.split(rewrite.canonical).join(rewrite.raw)
      }
    }
    return current
  }

  const walk = (node: THastElementContent | THastRootContent | null | undefined): void => {
    if (!node) return
    if ((node as { type?: string }).type === 'text') {
      const textNode = node as { value?: string }
      const replaced = replaceValue(textNode.value)
      if (replaced !== undefined) {
        textNode.value = replaced
      }
      return
    }
    if (isElementNode(node)) {
      const element = node as THastElement
      if (Array.isArray(element.children)) {
        for (const child of element.children) {
          walk(child as THastElementContent | THastRootContent)
        }
      }
    }
  }

  walk(root as unknown as THastElementContent)
  return root
}

const sanitizeRenderedHtml = (html: string): string => {
  if (!html) return html
  return html.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/g, '')
}

/**
 * Normalises the emitted Twoslash tooltip helper that ships with Expressive Code.
 * The upstream script uses `@floating-ui/dom` to position tooltips. We intercept
 * the generated module to guard against zero-sized targets, toggle visibility
 * deterministically, and (crucially) decide which container receives the popup.
 * The docs pipeline simply forwards these modules, so this patch is the single
 * source of truth for tooltip behaviour on the site.
 */
const patchJsModules = (modules: readonly string[]): string[] =>
  modules.map((moduleCode) =>
    moduleCode.includes('function setupTooltip')
      ? (() => {
          let patched = moduleCode
          // Anchor the tooltip in `document.body` so a single container handles
          // overlays for both the docs and the example demo. We adjust the computed
          // coordinates below to account for window scroll offset so placement stays
          // consistent even when the page is scrolled far past the snippet.
          const anchorPattern = 's.closest(".expressive-code")'
          if (patched.includes(anchorPattern)) {
            patched = patched.split(anchorPattern).join('document.body')
          }
          if (!patched.includes('if(!s)return;')) {
            patched = patched.replace(
              'let s=e.querySelector(".twoslash-popup-container"),',
              'let s=e.querySelector(".twoslash-popup-container");if(!s)return;let ',
            )
          }
          if (!patched.includes('let a=!1,r,u=0;')) {
            patched = patched.replace('let a=!1,r;', 'let a=!1,r,u=0;')
          }
          if (!patched.includes('return void requestAnimationFrame(n);')) {
            patched = patched.replace(
              'function n(){clearTimeout(r),t.appendChild(s),',
              'function n(){clearTimeout(r);const c=e.getBoundingClientRect();if(c.width===0&&c.height===0){if(u<5){u+=1;return void requestAnimationFrame(n);}return;}u=0;t.appendChild(s),',
            )
          }
          if (patched.includes('t.appendChild(s),t.appendChild(s),')) {
            patched = patched.replace('t.appendChild(s),t.appendChild(s),', 't.appendChild(s),')
          }
          if (!patched.includes('s.style.visibility="hidden",new Promise')) {
            patched = patched.replace(
              't.appendChild(s),new Promise',
              't.appendChild(s),s.style.position="absolute",s.style.display="block",s.style.visibility="hidden",new Promise',
            )
          }
          if (!patched.includes('s.style.visibility="visible",s.setAttribute')) {
            patched = patched.replace(
              // biome-ignore lint/suspicious/noTemplateCurlyInString: it's ok
              'Object.assign(s.style,{display:"block",left:`${o?20:e}px`,top:t+"px"})',
              // biome-ignore lint/suspicious/noTemplateCurlyInString: it's ok
              'Object.assign(s.style,{left:`${o?20:e}px`,top:t+"px"}),s.style.visibility="visible"',
            )
          }
          if (!patched.includes('s.style.display="none",s.style.visibility="hidden"')) {
            patched = patched.replace('s.style.display="none"', 's.style.display="none",s.style.visibility="hidden"')
          }
          return patched
        })()
      : moduleCode,
  )

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
 * Loads the Expressive Code/Twoslash renderer using the docs configuration.
 * This keeps the CLI aligned with the runtime renderer without duplicating config state.
 */
const loadEcRenderer = (
  paths: TwoslashProjectPaths,
  runtimeOptions: TwoslashRuntimeOptions,
): Effect.Effect<{ renderer: TExpressiveRenderer; configHash: string }, SnippetBuildError> =>
  Effect.tryPromise({
    try: async () => {
      const { config, fingerprintHash } = createExpressiveCodeConfig(paths, runtimeOptions)
      const renderer = await astroExpressiveCodeModuleStatic.createRenderer(config)
      const typedRenderer = renderer as TExpressiveRenderer
      return {
        renderer: {
          ...typedRenderer,
          jsModules: patchJsModules(typedRenderer.jsModules),
        },
        configHash: fingerprintHash,
      }
    },
    catch: (cause) => {
      if (process.env.TWOSLASH_DEBUG === '1') {
        console.error('astro-twoslash-code: failed to load Expressive Code renderer', cause)
      }
      return new SnippetBuildError({ message: 'Unable to load Expressive Code renderer', cause })
    },
  })

type TRenderedSnippet = {
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
  fileOrder: readonly string[]
  files: Record<
    string,
    {
      content: string
      isMain: boolean
      hash: string
    }
  >
  rendered: Record<string, TRenderedSnippet>
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

type TManifestEntry = {
  entryFile: string
  mainFilename: string
  artifactPath: string
  bundleHash: string
}

type TPreviousManifest = {
  entries: Map<string, TManifestEntry>
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
      const canonicalFiles = createVirtualFiles(bundle.files, bundle.fileOrder)
      const focusRecord = canonicalFiles.find((file) => file.relativePath === focusFilename)
      const virtualFiles = remapVirtualPathsForFocus(canonicalFiles, focusFilename)
      const focusVirtualPath = resolveFocusVirtualPath(virtualFiles, focusFilename)

      const snippetFiles = virtualFiles.map((file) => ({
        virtualPath: file.virtualPath,
        content: file.content,
      }))
      const assembled = assembleSnippet(snippetFiles, focusVirtualPath)
      const language = guessLanguage(focusFilename)
      let html: string | null = null
      let styles: string[] = []
      let diagnostics: string[] = []
      let renderResult: THastRendererResult
      try {
        renderResult = await renderer.ec.render({ code: assembled.code, language, meta: 'twoslash' })
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

      const trimmedAst = trimRenderedAst(renderResult.renderedGroupAst, focusVirtualPath, assembled)
      const restoredAst = restoreFocusSpecifiers(trimmedAst, focusRecord?.relativeImports ?? [])
      diagnostics = collectDiagnostics(restoredAst)
      html = sanitizeRenderedHtml(toHtml(restoredAst))
      html = stripSentinelsFromDataCodeAttributes(html)
      styles = Array.from(renderResult.styles)
      return {
        html,
        language,
        meta: 'twoslash',
        diagnostics,
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
  }).pipe(Effect.withSpan(`renderSnippet:${focusFilename}`, { attributes: { filename: focusFilename } }))

const loadPreviousManifest = (
  fs: FileSystem.FileSystem,
  paths: TwoslashProjectPaths,
  expectedConfigHash: string,
): Effect.Effect<TPreviousManifest | null, never> =>
  Effect.gen(function* () {
    const manifestExistsResult = yield* fs.exists(paths.manifestPath).pipe(Effect.either)
    if (manifestExistsResult._tag === 'Left') {
      yield* Effect.logWarning(
        `Unable to check existing snippet manifest at ${paths.manifestPath}: ${String(manifestExistsResult.left)}`,
      )
      return null
    }
    if (manifestExistsResult.right === false) {
      return null
    }

    const manifestSourceResult = yield* fs.readFileString(paths.manifestPath).pipe(Effect.either)
    if (manifestSourceResult._tag === 'Left') {
      yield* Effect.logWarning(
        `Unable to read existing snippet manifest at ${paths.manifestPath}: ${String(manifestSourceResult.left)}`,
      )
      return null
    }

    const manifestSource = manifestSourceResult.right
    let parsed: TSnippetManifest
    try {
      parsed = JSON.parse(manifestSource) as TSnippetManifest
    } catch (error) {
      yield* Effect.logWarning(`Unable to parse existing snippet manifest at ${paths.manifestPath}: ${String(error)}`)
      return null
    }

    if (parsed.version !== 1 || parsed.configHash !== expectedConfigHash) {
      return null
    }

    const entries = new Map<string, TManifestEntry>()
    for (const entry of parsed.entries ?? []) {
      if (!entry?.entryFile) continue
      entries.set(entry.entryFile, {
        entryFile: entry.entryFile,
        mainFilename: entry.mainFilename,
        artifactPath: entry.artifactPath,
        bundleHash: entry.bundleHash,
      })
    }

    return { entries }
  })

export type BuildSnippetsOptions = {
  projectRoot?: string
  runtime?: TwoslashRuntimeOptions
}

type ResolvedBuildOptions = {
  paths: TwoslashProjectPaths
  runtimeOptions: TwoslashRuntimeOptions
}

const resolveOptions = (options: BuildSnippetsOptions = {}): ResolvedBuildOptions => {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd()
  const runtimeOptions = normalizeRuntimeOptions(options.runtime)
  return {
    paths: resolveProjectPaths(projectRoot),
    runtimeOptions,
  }
}

/**
 * CLI entry-point that pre-renders all snippet bundles and emits artefacts + manifest.
 * This command runs before `mono docs build` to guarantee cached HTML is available during Astro builds.
 */
const buildSnippetsInternal = ({ paths, runtimeOptions }: ResolvedBuildOptions) =>
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

    const { renderer, configHash } = yield* loadEcRenderer(paths, runtimeOptions)
    const previousManifest = yield* loadPreviousManifest(fs, paths, configHash)
    const previousEntries = previousManifest?.entries ?? new Map<string, TManifestEntry>()
    const artifactEntries: Array<TSnippetManifest['entries'][number]> = []
    let renderedCount = 0

    yield* Effect.log(`Rendering ${snippetEntries.length} snippet bundles`)

    const buildSnippet = (entry: TSnippetEntry) =>
      Effect.gen(function* () {
        const bundle = buildSnippetBundle({ entryFilePath: entry.entryPath, baseDir: paths.snippetAssetsRoot })
        const entryFileRelative = path.relative(paths.snippetAssetsRoot, bundle.entryFilePath).replace(/\\/g, '/')

        const filesWithHash = bundle.fileOrder.map((filename, index) => {
          const file = bundle.files[filename]
          if (!file) {
            throw new SnippetBuildError({
              message: `Snippet bundle missing file record for ${filename}`,
              entry: entry.entryPath,
            })
          }
          return {
            filename,
            content: file.content,
            isMain: index === 0,
            hash: hashString(file.content),
          }
        })

        const bundleHash = hashString(
          JSON.stringify({
            files: filesWithHash.map((file) => ({ filename: file.filename, hash: file.hash })),
            meta: 'twoslash',
          }),
        )

        const cachedEntry = previousEntries.get(entryFileRelative)
        if (cachedEntry && cachedEntry.bundleHash === bundleHash) {
          const cachedArtifactPath = path.join(paths.cacheRoot, cachedEntry.artifactPath)
          const cachedArtifactExists = yield* fs.exists(cachedArtifactPath)
          if (cachedArtifactExists) {
            artifactEntries.push({
              entryFile: cachedEntry.entryFile,
              mainFilename: cachedEntry.mainFilename,
              artifactPath: cachedEntry.artifactPath,
              bundleHash: cachedEntry.bundleHash,
            })
            return
          }
        }

        yield* Effect.log(`Rendering snippet bundle for ${entry.entryPath}`)

        const renderedSnippets: Record<string, TRenderedSnippet> = {}
        for (const filename of bundle.fileOrder) {
          const rendered = yield* renderSnippet(renderer, bundle, filename)
          if (rendered.html === null && rendered.diagnostics.length > 0) {
            yield* Effect.logWarning(
              `Twoslash pre-rendering skipped for ${entry.entryPath}: ${rendered.diagnostics[0]}`,
            )
          }
          renderedSnippets[filename] = rendered
        }

        const artifact: TSnippetArtifact = {
          version: 1,
          entryFile: entryFileRelative,
          mainFilename: bundle.mainFileRelativePath,
          bundleHash,
          generatedAt: new Date().toISOString(),
          fileOrder: bundle.fileOrder,
          files: filesWithHash.reduce<
            Record<
              string,
              {
                content: string
                isMain: boolean
                hash: string
              }
            >
          >((acc, file) => {
            acc[file.filename] = {
              content: file.content,
              isMain: file.isMain,
              hash: file.hash,
            }
            return acc
          }, {}),
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

        renderedCount += 1
      }).pipe(Effect.withSpan(`buildSnippet:${entry.entryPath}`, { attributes: { entryPath: entry.entryPath } }))

    yield* Effect.forEach(snippetEntries, buildSnippet)

    const manifest: TSnippetManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      configHash,
      baseStyles: renderer.baseStyles,
      themeStyles: renderer.themeStyles,
      jsModules: renderer.jsModules,
      entries: artifactEntries,
    }

    yield* fs
      .writeFileString(path.join(paths.cacheRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      .pipe(Effect.mapError((cause) => new SnippetBuildError({ message: 'Unable to write snippets manifest', cause })))

    const cacheHits = snippetEntries.length - renderedCount
    yield* Effect.log(`Rendered ${renderedCount} snippet bundles (${cacheHits} cache hits)`)

    return renderedCount
  })

const normalizeOptions = (options: BuildSnippetsOptions = {}): BuildSnippetsOptions => {
  const normalized: BuildSnippetsOptions = {}
  if (options.projectRoot !== undefined) {
    normalized.projectRoot = options.projectRoot
  }
  if (options.runtime !== undefined) {
    normalized.runtime = normalizeRuntimeOptions(options.runtime)
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
  runtime,
  commandName = 'snippets',
}: CreateSnippetsCommandOptions = {}) => {
  const resolved = resolveOptions(
    normalizeOptions({
      ...(projectRoot !== undefined ? { projectRoot } : {}),
      ...(runtime !== undefined ? { runtime } : {}),
    }),
  )

  const buildHandler = Effect.withSpan('astro-twoslash-code/cli/snippets-build')(buildSnippetsInternal(resolved)).pipe(
    Effect.asVoid,
  )

  const buildCommand = Cli.Command.make('build', {}, () => buildHandler)

  return Cli.Command.make(commandName).pipe(Cli.Command.withSubcommands([buildCommand]))
}

export const __internal = {
  assembleSnippet,
  createVirtualFiles,
  resolveFocusVirtualPath,
  sanitizeSnippetContent,
  guessLanguage,
  trimRenderedAst,
  extractCanonicalOwner,
  renderSnippet,
  loadEcRenderer,
}
