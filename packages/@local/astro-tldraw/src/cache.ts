import crypto from 'node:crypto'
import path from 'node:path'

import { Effect, FileSystem, Schema } from '@livestore/utils/effect'
import type { RenderResult } from './renderer.ts'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

export class FileSystemError extends Schema.TaggedError<FileSystemError>()('Tldraw.FileSystemError', {
  path: Schema.String,
  operation: Schema.String,
  cause: Schema.Any,
}) {}

export interface DiagramCacheEntry {
  /** Relative path from diagrams root (e.g., "architecture.tldr") */
  entryFile: string
  /** Path to cached artifact relative to cache root */
  artifactPath: string
  /** Hash of source .tldr file */
  sourceHash: string
  /** Hash of light SVG content */
  lightSvgHash: string
  /** Hash of dark SVG content */
  darkSvgHash: string
  /** ISO timestamp of when this was generated */
  generatedAt: string
}

export interface DiagramManifest {
  entries: DiagramCacheEntry[]
  version: string
}

export interface CachedDiagram {
  lightSvg: string
  darkSvg: string
  sourceHash: string
  generatedAt: string
  metadata: {
    width?: number
    height?: number
  }
}

const MANIFEST_FILENAME = 'manifest.json'
const CACHE_VERSION = '1.0.0'

/** Paths for tldraw diagram caching */
export interface TldrawCachePaths {
  /** Root directory for all cache data (e.g., docs/node_modules/.astro-tldraw) */
  cacheRoot: string
  /** Path to manifest.json */
  manifestPath: string
  /** Root directory containing .tldr source files */
  diagramsRoot: string
}

export const resolveCachePaths = (projectRoot: string): TldrawCachePaths => {
  const cacheRoot = path.join(projectRoot, 'node_modules', '.astro-tldraw')
  const manifestPath = path.join(cacheRoot, MANIFEST_FILENAME)
  const diagramsRoot = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams')

  return {
    cacheRoot,
    manifestPath,
    diagramsRoot,
  }
}

/** Load existing manifest or return empty one */
export const loadManifest = (
  manifestPath: string,
): Effect.Effect<DiagramManifest, FileSystemError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.cache.load-manifest')(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      const manifest = yield* fs.readFileString(manifestPath).pipe(
        Effect.map((content) => JSON.parse(content) as DiagramManifest),
        Effect.mapError((cause) => new FileSystemError({ path: manifestPath, operation: 'read manifest', cause })),
        Effect.catchAll(() =>
          Effect.succeed({
            entries: [],
            version: CACHE_VERSION,
          }),
        ),
      )

      return manifest
    }),
  )

/** Save manifest to disk */
export const saveManifest = (
  manifestPath: string,
  manifest: DiagramManifest,
): Effect.Effect<void, FileSystemError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.cache.save-manifest')(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      yield* fs
        .makeDirectory(path.dirname(manifestPath), { recursive: true })
        .pipe(Effect.mapError((cause) => new FileSystemError({ path: manifestPath, operation: 'mkdir', cause })))

      yield* fs
        .writeFileString(manifestPath, JSON.stringify(manifest, null, 2))
        .pipe(
          Effect.mapError((cause) => new FileSystemError({ path: manifestPath, operation: 'write manifest', cause })),
        )
    }),
  )

/** Get cache entry for a specific diagram */
export const getCacheEntry = (manifest: DiagramManifest, entryFile: string): DiagramCacheEntry | undefined =>
  manifest.entries.find((entry) => entry.entryFile === entryFile)

/** Check if cached diagram is still valid */
export const isCacheValid = (entry: DiagramCacheEntry | undefined, currentSourceHash: string): boolean => {
  if (!entry) return false
  return entry.sourceHash === currentSourceHash
}

/** Generate artifact path for a diagram, preserving directory structure */
const getArtifactPath = (entryFile: string): string => {
  /* Remove .tldr extension and preserve relative path to ensure uniqueness */
  const withoutExt = entryFile.replace(/\.tldr$/, '')
  return path.join(withoutExt, 'diagram.json')
}

/** Save rendered diagram to cache */
export const saveDiagramToCache = (
  paths: TldrawCachePaths,
  entryFile: string,
  renderResult: RenderResult,
  metadata?: { width?: number; height?: number },
): Effect.Effect<DiagramCacheEntry, FileSystemError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.cache.save-diagram')(
    Effect.gen(function* () {
      const artifactPath = getArtifactPath(entryFile)
      const fullArtifactPath = path.join(paths.cacheRoot, artifactPath)

      /* Ensure directory exists */
      const fs = yield* FileSystem.FileSystem

      yield* fs
        .makeDirectory(path.dirname(fullArtifactPath), { recursive: true })
        .pipe(Effect.mapError((cause) => new FileSystemError({ path: fullArtifactPath, operation: 'mkdir', cause })))

      /* Prepare cached diagram data */
      const cachedDiagram: CachedDiagram = {
        lightSvg: renderResult.lightSvg,
        darkSvg: renderResult.darkSvg,
        sourceHash: renderResult.sourceHash,
        generatedAt: renderResult.timestamp,
        metadata: metadata ?? {},
      }

      /* Write to disk */
      yield* fs
        .writeFileString(fullArtifactPath, JSON.stringify(cachedDiagram, null, 2))
        .pipe(
          Effect.mapError(
            (cause) => new FileSystemError({ path: fullArtifactPath, operation: 'write diagram', cause }),
          ),
        )

      /* Create cache entry */
      const entry: DiagramCacheEntry = {
        entryFile,
        artifactPath,
        sourceHash: renderResult.sourceHash,
        lightSvgHash: hashString(renderResult.lightSvg),
        darkSvgHash: hashString(renderResult.darkSvg),
        generatedAt: renderResult.timestamp,
      }

      yield* Effect.annotateCurrentSpan({ entryFile, artifactPath })

      return entry
    }),
  )

/** Load cached diagram from disk */
export const loadCachedDiagram = (
  paths: TldrawCachePaths,
  entry: DiagramCacheEntry,
): Effect.Effect<CachedDiagram, FileSystemError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.cache.load-diagram')(
    Effect.gen(function* () {
      const fullArtifactPath = path.join(paths.cacheRoot, entry.artifactPath)
      const fs = yield* FileSystem.FileSystem
      const content = yield* fs
        .readFileString(fullArtifactPath)
        .pipe(
          Effect.mapError((cause) => new FileSystemError({ path: fullArtifactPath, operation: 'read diagram', cause })),
        )

      yield* Effect.annotateCurrentSpan({ entryFile: entry.entryFile, artifactPath: entry.artifactPath })

      return JSON.parse(content) as CachedDiagram
    }),
  )

/** Update manifest with new/updated entry */
export const updateManifestEntry = (manifest: DiagramManifest, entry: DiagramCacheEntry): DiagramManifest => {
  const existingIndex = manifest.entries.findIndex((e) => e.entryFile === entry.entryFile)

  if (existingIndex >= 0) {
    /* Update existing entry */
    const updatedEntries = [...manifest.entries]
    updatedEntries[existingIndex] = entry
    return {
      ...manifest,
      entries: updatedEntries,
    }
  }

  /* Add new entry */
  return {
    ...manifest,
    entries: [...manifest.entries, entry],
  }
}
