import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  defaultRebuildCommand,
  formatRebuildInstruction,
  resolveProjectPaths,
  type TwoslashProjectPaths,
} from '../project-paths.ts'
import { buildSnippetBundle } from './snippet-graph.ts'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

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

const ensureFreshArtefact = (
  artefact: { files?: Array<{ filename: string; hash: string }> },
  bundle: { files: Array<{ relativePath: string; content: string }> },
  entryRelative: string,
  rebuildInstruction: string,
): void => {
  if (!Array.isArray(artefact?.files) || artefact.files.length === 0) {
    throw new Error(`Corrupted snippet artefact for ${entryRelative}. ${rebuildInstruction}`)
  }

  const storedHashes = new Map<string, string>()
  for (const file of artefact.files) {
    if (typeof file?.filename !== 'string' || typeof file.hash !== 'string') {
      throw new Error(`Incomplete snippet artefact for ${entryRelative}. ${rebuildInstruction}`)
    }
    storedHashes.set(file.filename, file.hash)
  }

  const seen = new Set<string>()
  for (const file of bundle.files) {
    const currentHash = hashString(file.content)
    const storedHash = storedHashes.get(file.relativePath)
    if (!storedHash || storedHash !== currentHash) {
      throw new Error(`Snippet '${entryRelative}' is stale. ${rebuildInstruction}`)
    }
    seen.add(file.relativePath)
  }

  if (storedHashes.size !== seen.size) {
    throw new Error(`Snippet '${entryRelative}' files changed. ${rebuildInstruction}`)
  }
}

export type TwoslashSnippetPluginOptions = {
  projectRoot?: string
  rebuildCommand?: string
}

export const createTwoslashSnippetPlugin = (options: TwoslashSnippetPluginOptions = {}): MinimalVitePlugin => {
  let paths: TwoslashProjectPaths = resolveProjectPaths(options.projectRoot ?? process.cwd())
  let rebuildCommand = options.rebuildCommand ?? defaultRebuildCommand
  let rebuildInstruction = formatRebuildInstruction(rebuildCommand)
  let manifestCache: ManifestCache | null = null

  const loadManifest = (): ManifestCache => {
    if (manifestCache) return manifestCache

    if (!fs.existsSync(paths.manifestPath)) {
      throw new Error(`Missing snippet manifest at ${paths.manifestPath}. ${rebuildInstruction}`)
    }

    const raw = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf-8')) as ManifestRaw
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
      rebuildCommand = options.rebuildCommand ?? defaultRebuildCommand
      rebuildInstruction = formatRebuildInstruction(rebuildCommand)
      manifestCache = null
    },

    buildStart() {
      manifestCache = null
    },

    transform(_code, id) {
      const [filepath, query] = id.split('?')
      if (!query || !query.includes('snippet') || !filepath) {
        return null
      }

      const manifest = loadManifest()
      const manifestGlobals = {
        baseStyles: typeof manifest.raw.baseStyles === 'string' ? manifest.raw.baseStyles : '',
        themeStyles: typeof manifest.raw.themeStyles === 'string' ? manifest.raw.themeStyles : '',
        jsModules: Array.isArray(manifest.raw.jsModules) ? manifest.raw.jsModules : [],
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

      const artefact = JSON.parse(fs.readFileSync(artefactPath, 'utf-8')) as {
        mainFilename?: string
        rendered?: Array<{
          filename: string
          html?: string | null
          language: string
          meta: string
          diagnostics?: string[]
          styles?: string[]
        }>
        bundleHash?: string
        generatedAt?: string
        files?: Array<{ filename: string; hash: string }>
      }
      const bundle = buildSnippetBundle({ entryFilePath: filepath, baseDir: paths.snippetAssetsRoot })
      ensureFreshArtefact(artefact, bundle, entryRelative, rebuildInstruction)

      const payload = {
        files: Array.isArray(artefact.files) ? artefact.files : [],
        mainFilename: artefact.mainFilename ?? bundle.mainFileRelativePath,
        rendered: Array.isArray(artefact.rendered) ? artefact.rendered : [],
        globals: manifestGlobals,
        bundleHash: artefact.bundleHash ?? null,
        generatedAt: artefact.generatedAt ?? null,
      }

      return {
        code: `export default ${JSON.stringify(payload)}`,
        map: null,
      }
    },
  }
}

export const vitePluginSnippet = (): MinimalVitePlugin => createTwoslashSnippetPlugin()
