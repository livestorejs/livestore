import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldNeverHappen } from '@livestore/utils'
import { createExpressiveCodeConfig, normalizeRuntimeOptions, type TwoslashRuntimeOptions } from '../expressive-code.ts'
import { formatRebuildInstruction, resolveProjectPaths, type TwoslashProjectPaths } from '../project-paths.ts'
import { buildSnippetBundle, type SnippetBundle } from './snippet-graph.ts'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const SNIPPET_QUERY = 'snippet'
const SNIPPET_RAW_QUERY = 'snippet-raw'

interface ManifestEntry {
  entryFile: string
  artifactPath: string
  bundleHash: string
}

interface ManifestRaw {
  entries?: ManifestEntry[]
  baseStyles?: string
  themeStyles?: string
  jsModules?: string[]
  configHash?: string
}

interface ManifestCache {
  raw: ManifestRaw
  byEntry: Map<string, ManifestEntry>
}

type MinimalVitePlugin = {
  name: string
  enforce?: 'pre' | 'post'
  configResolved?: (config: { root: string }) => void
  buildStart?: () => void
  transform: (code: string, id: string) => { code: string; map: null } | null
}

export interface TwoslashSnippetFile {
  content: string
  hash: string
  isMain: boolean
  [key: string]: unknown
}

export interface TwoslashSnippetRenderedEntry {
  html: string | null
  language: string
  meta: string
  diagnostics: string[]
  styles: string[]
  [key: string]: unknown
}

export interface TwoslashSnippetGlobals {
  baseStyles: string
  themeStyles: string
  jsModules: string[]
}

export interface TwoslashSnippetPayload {
  files: Record<string, TwoslashSnippetFile>
  fileOrder?: readonly string[]
  mainFilename: string
  rendered: Record<string, TwoslashSnippetRenderedEntry>
  globals: TwoslashSnippetGlobals
  bundleHash: string | null
  generatedAt: string | null
}

const multiCodeComponentSpecifier = (() => {
  const filePath = fileURLToPath(new URL('../components/MultiCode.astro', import.meta.url))
  const normalized = filePath.replace(/\\/g, '/')
  return `/@fs${normalized}`
})()

const ensureFreshArtefact = (
  validationHashes: Record<string, string>,
  bundle: SnippetBundle,
  entryRelative: string,
  rebuildInstruction: string,
): void => {
  const entries = Object.entries(validationHashes)
  if (entries.length === 0) {
    throw new Error(`Corrupted snippet artefact for ${entryRelative}. ${rebuildInstruction}`)
  }

  const storedHashes = new Map(entries)
  const seen = new Set<string>()

  for (const filename of bundle.fileOrder) {
    const file = bundle.files[filename]
    if (!file) {
      throw new Error(`Snippet '${entryRelative}' is missing expected file ${filename}. ${rebuildInstruction}`)
    }
    const currentHash = hashString(file.content)
    const storedHash = storedHashes.get(filename)
    if (!storedHash || storedHash !== currentHash) {
      throw new Error(`Snippet '${entryRelative}' is stale. ${rebuildInstruction}`)
    }
    seen.add(filename)
  }

  if (storedHashes.size !== seen.size) {
    throw new Error(`Snippet '${entryRelative}' files changed. ${rebuildInstruction}`)
  }
}

const createComponentModuleSource = (serializedPayload: string, componentSpecifier: string): string =>
  [
    `import MultiCode from ${JSON.stringify(componentSpecifier)}`,
    '',
    `export const snippetData = ${serializedPayload}`,
    '',
    'const Component = (result, props, slots) => MultiCode(result, { ...props, code: snippetData }, slots)',
    'Component.prototype = MultiCode.prototype',
    'Component.isAstroComponentFactory = MultiCode.isAstroComponentFactory === true',
    'if (typeof MultiCode.moduleId === "string") Component.moduleId = MultiCode.moduleId',
    'if (typeof MultiCode.moduleSpecifier === "string") Component.moduleSpecifier = MultiCode.moduleSpecifier',
    'if (typeof MultiCode.propagation === "object" && MultiCode.propagation !== null) Component.propagation = MultiCode.propagation',
    'Object.defineProperty(Component, "name", { value: MultiCode.name, configurable: true })',
    'for (const symbol of Object.getOwnPropertySymbols(MultiCode)) {',
    '  Component[symbol] = MultiCode[symbol]',
    '}',
    'export default Component',
    '',
  ].join('\n')

const parseSnippetMode = (rawQuery: string): 'component' | 'raw' | null => {
  const tokens = rawQuery
    .split('&')
    .map((segment) => segment.split('=')[0]?.trim() ?? '')
    .filter((token) => token.length > 0)

  let rawSeen = false
  for (const token of tokens) {
    if (token === SNIPPET_QUERY) {
      return 'component'
    }
    if (token === SNIPPET_RAW_QUERY) {
      rawSeen = true
    }
  }

  return rawSeen ? 'raw' : null
}

const collectSnippetFiles = (
  filesField: unknown,
  orderField: unknown,
): {
  files: Record<string, TwoslashSnippetFile>
  fileOrder: string[]
  validationHashes: Record<string, string>
} => {
  const files: Record<string, TwoslashSnippetFile> = {}
  const validationHashes: Record<string, string> = {}

  if (isRecord(filesField) && !Array.isArray(filesField)) {
    for (const [rawFilename, rawValue] of Object.entries(filesField)) {
      if (!isRecord(rawValue)) continue
      const filename = rawFilename.replace(/\\/g, '/').trim()
      if (filename.length === 0) continue

      if (typeof rawValue.content !== 'string' || rawValue.content.length === 0) {
        throw new Error(`Snippet file ${filename} missing content`)
      }
      if (typeof rawValue.hash !== 'string' || rawValue.hash.length === 0) {
        throw new Error(`Snippet file ${filename} missing hash`)
      }

      const snippetFile: TwoslashSnippetFile = {
        content: rawValue.content,
        hash: rawValue.hash,
        isMain: rawValue.isMain === true,
      }
      validationHashes[filename] = rawValue.hash

      for (const [key, value] of Object.entries(rawValue)) {
        if (key === 'content' || key === 'isMain' || key === 'hash') continue
        snippetFile[key] = value
      }

      files[filename] = snippetFile
    }
  } else if (Array.isArray(filesField)) {
    for (const entry of filesField) {
      if (!isRecord(entry)) continue
      const filenameValue = typeof entry.filename === 'string' ? entry.filename.replace(/\\/g, '/').trim() : ''
      if (filenameValue.length === 0) continue

      if (typeof entry.content !== 'string' || entry.content.length === 0) {
        throw new Error(`Snippet file ${filenameValue} missing content`)
      }
      if (typeof entry.hash !== 'string' || entry.hash.length === 0) {
        throw new Error(`Snippet file ${filenameValue} missing hash`)
      }

      const snippetFile: TwoslashSnippetFile = {
        content: entry.content,
        hash: entry.hash,
        isMain: entry.isMain === true,
      }
      validationHashes[filenameValue] = entry.hash

      for (const [key, value] of Object.entries(entry)) {
        if (key === 'filename' || key === 'content' || key === 'isMain' || key === 'hash') continue
        snippetFile[key] = value
      }

      files[filenameValue] = snippetFile
    }
  }

  let fileOrder: string[] = []
  if (Array.isArray(orderField)) {
    fileOrder = orderField
      .map((value) => (typeof value === 'string' ? value.replace(/\\/g, '/').trim() : ''))
      .filter((value) => value.length > 0)
  }
  if (fileOrder.length === 0) {
    fileOrder = Object.keys(files)
  }

  return { files, fileOrder, validationHashes }
}

const collectRenderedEntries = (renderedField: unknown): Record<string, TwoslashSnippetRenderedEntry> => {
  const rendered: Record<string, TwoslashSnippetRenderedEntry> = {}

  const assignEntry = (filename: string, entry: TwoslashSnippetRenderedEntry) => {
    rendered[filename] = entry
  }

  if (isRecord(renderedField) && !Array.isArray(renderedField)) {
    for (const [rawFilename, rawValue] of Object.entries(renderedField)) {
      if (!isRecord(rawValue)) continue
      const filename = rawFilename.replace(/\\/g, '/').trim()
      if (filename.length === 0) continue

      const diagnostics = Array.isArray(rawValue.diagnostics)
        ? rawValue.diagnostics.filter((value): value is string => typeof value === 'string')
        : []
      const styles = Array.isArray(rawValue.styles)
        ? rawValue.styles.filter((value): value is string => typeof value === 'string')
        : []

      assignEntry(filename, {
        html: typeof rawValue.html === 'string' ? rawValue.html : null,
        language: typeof rawValue.language === 'string' && rawValue.language.length > 0 ? rawValue.language : 'ts',
        meta: typeof rawValue.meta === 'string' && rawValue.meta.length > 0 ? rawValue.meta : 'twoslash',
        diagnostics,
        styles,
      })
    }
    return rendered
  }

  if (!Array.isArray(renderedField)) {
    return rendered
  }

  for (const entry of renderedField) {
    if (!isRecord(entry)) continue
    const filenameValue = typeof entry.filename === 'string' ? entry.filename.replace(/\\/g, '/').trim() : ''
    if (filenameValue.length === 0) continue

    const diagnostics = Array.isArray(entry.diagnostics)
      ? entry.diagnostics.filter((value): value is string => typeof value === 'string')
      : []
    const styles = Array.isArray(entry.styles)
      ? entry.styles.filter((value): value is string => typeof value === 'string')
      : []

    const renderedRecord: TwoslashSnippetRenderedEntry = {
      html: typeof entry.html === 'string' ? entry.html : null,
      language: typeof entry.language === 'string' && entry.language.length > 0 ? entry.language : 'ts',
      meta: typeof entry.meta === 'string' && entry.meta.length > 0 ? entry.meta : 'twoslash',
      diagnostics,
      styles,
    }

    for (const [key, value] of Object.entries(entry)) {
      if (
        key === 'filename' ||
        key === 'html' ||
        key === 'language' ||
        key === 'meta' ||
        key === 'diagnostics' ||
        key === 'styles'
      ) {
        continue
      }
      renderedRecord[key] = value
    }

    assignEntry(filenameValue, renderedRecord)
  }

  return rendered
}
export type TwoslashSnippetPluginOptions = {
  projectRoot?: string
  runtime?: TwoslashRuntimeOptions
}

export const createTwoslashSnippetPlugin = (options: TwoslashSnippetPluginOptions = {}): MinimalVitePlugin => {
  let paths: TwoslashProjectPaths = resolveProjectPaths(
    options.projectRoot ?? shouldNeverHappen('projectRoot is not set'),
  )
  let rebuildInstruction = formatRebuildInstruction()
  let manifestCache: ManifestCache | null = null
  const runtimeOptions = normalizeRuntimeOptions(options.runtime)
  let expectedConfigHash: string | null = null

  const loadManifest = (): ManifestCache => {
    if (manifestCache) return manifestCache

    if (!fs.existsSync(paths.manifestPath)) {
      throw new Error(`Missing snippet manifest at ${paths.manifestPath}. ${rebuildInstruction}`)
    }

    const raw = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf-8')) as ManifestRaw
    const manifestConfigHash = typeof raw.configHash === 'string' ? raw.configHash : null
    const expectedHash = (() => {
      if (expectedConfigHash !== null) {
        return expectedConfigHash
      }
      try {
        const { fingerprintHash } = createExpressiveCodeConfig(paths, runtimeOptions)
        expectedConfigHash = fingerprintHash
        return fingerprintHash
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`Unable to compute Expressive Code configuration (${reason}). ${rebuildInstruction}`)
      }
    })()

    if (manifestConfigHash === null || manifestConfigHash !== expectedHash) {
      throw new Error(`Snippet manifest is stale. ${rebuildInstruction}`)
    }

    const byEntry = new Map<string, ManifestEntry>()
    for (const entry of raw.entries ?? []) {
      if (entry?.entryFile) byEntry.set(entry.entryFile, entry)
    }

    manifestCache = { raw, byEntry }
    return manifestCache
  }

  return {
    name: '@local/astro-twoslash-code/vite-plugin-snippet',
    enforce: 'pre',

    configResolved(config) {
      if (!options.projectRoot) {
        paths = resolveProjectPaths(config.root)
      }
      rebuildInstruction = formatRebuildInstruction()
      manifestCache = null
      expectedConfigHash = null
    },

    buildStart() {
      manifestCache = null
      expectedConfigHash = null
    },

    transform(_code, id) {
      const [filepath, rawQuery] = id.split('?')
      if (!filepath || !rawQuery) {
        return null
      }

      const mode = parseSnippetMode(rawQuery)
      if (!mode) {
        return null
      }

      const manifest = loadManifest()
      const manifestGlobals: TwoslashSnippetGlobals = {
        baseStyles: typeof manifest.raw.baseStyles === 'string' ? manifest.raw.baseStyles : '',
        themeStyles: typeof manifest.raw.themeStyles === 'string' ? manifest.raw.themeStyles : '',
        jsModules: Array.isArray(manifest.raw.jsModules)
          ? manifest.raw.jsModules.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
          : [],
      }
      const entryRelative = path.relative(paths.snippetAssetsRoot, filepath).replace(/\\/g, '/')
      const manifestEntry = manifest.byEntry.get(entryRelative)
      if (!manifestEntry) {
        throw new Error(`No cached snippet artefact for ${entryRelative}. ${rebuildInstruction}`)
      }

      const artefactPath = path.join(paths.cacheRoot, manifestEntry.artifactPath)
      if (!fs.existsSync(artefactPath)) {
        throw new Error(`Missing snippet artefact at ${artefactPath}. ${rebuildInstruction}`)
      }

      const artefactData = JSON.parse(fs.readFileSync(artefactPath, 'utf-8')) as unknown
      if (!isRecord(artefactData)) {
        throw new Error(`Invalid snippet artefact for ${entryRelative}. ${rebuildInstruction}`)
      }
      const artefactRecord = artefactData as {
        files?: unknown
        rendered?: unknown
        mainFilename?: unknown
        bundleHash?: unknown
        generatedAt?: unknown
        fileOrder?: unknown
      } & Record<string, unknown>

      const bundle = buildSnippetBundle({ entryFilePath: filepath, baseDir: paths.snippetAssetsRoot })

      const filesField = artefactRecord.files
      const orderField = artefactRecord.fileOrder
      const { files, fileOrder, validationHashes } = collectSnippetFiles(filesField, orderField)
      ensureFreshArtefact(validationHashes, bundle, entryRelative, rebuildInstruction)

      const renderedField = artefactRecord.rendered
      const rendered = collectRenderedEntries(renderedField)

      const mainFilenameCandidate = artefactRecord.mainFilename
      const bundleHashCandidate = artefactRecord.bundleHash
      const generatedAtCandidate = artefactRecord.generatedAt

      const payload: TwoslashSnippetPayload = {
        files,
        fileOrder: fileOrder.length > 0 ? fileOrder : bundle.fileOrder,
        mainFilename:
          typeof mainFilenameCandidate === 'string' && mainFilenameCandidate.length > 0
            ? mainFilenameCandidate
            : bundle.mainFileRelativePath,
        rendered,
        globals: manifestGlobals,
        bundleHash:
          typeof bundleHashCandidate === 'string' && bundleHashCandidate.length > 0 ? bundleHashCandidate : null,
        generatedAt:
          typeof generatedAtCandidate === 'string' && generatedAtCandidate.length > 0 ? generatedAtCandidate : null,
      }

      const serializedPayload = JSON.stringify(payload)

      if (mode === 'raw') {
        return {
          code: `export default ${serializedPayload}`,
          map: null,
        }
      }

      return {
        code: createComponentModuleSource(serializedPayload, multiCodeComponentSpecifier),
        map: null,
      }
    },
  }
}

export const vitePluginSnippet = (): MinimalVitePlugin => createTwoslashSnippetPlugin()
