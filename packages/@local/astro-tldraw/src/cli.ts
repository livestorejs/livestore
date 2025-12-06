import os from 'node:os'
import path from 'node:path'

import { Effect, FileSystem, Schema } from '@livestore/utils/effect'

import {
  FileSystemError,
  getCacheEntry,
  isCacheValid,
  loadManifest,
  resolveCachePaths,
  saveDiagramToCache,
  saveManifest,
  updateManifestEntry,
} from './cache.ts'
import {
  getSvgDimensions,
  type RenderInvocationError,
  type RenderTimeoutError,
  readTldrawFile,
  renderTldrawToSvg,
} from './renderer.ts'

export interface BuildDiagramsOptions {
  projectRoot: string
  verbose?: boolean
}

export class DiagramDiscoveryError extends Schema.TaggedError<DiagramDiscoveryError>()('Tldraw.DiagramDiscoveryError', {
  path: Schema.String,
  cause: Schema.Any,
}) {}

export type BuildDiagramsError = FileSystemError | RenderTimeoutError | RenderInvocationError | DiagramDiscoveryError

/** Discover all .tldr files in the diagrams directory recursively */
const discoverDiagramFiles = (
  diagramsRoot: string,
): Effect.Effect<string[], DiagramDiscoveryError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.discover-diagrams')(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const results: string[] = []

      const walk = (dir: string): Effect.Effect<void, DiagramDiscoveryError> =>
        Effect.gen(function* () {
          const entries = yield* fs
            .readDirectory(dir)
            .pipe(Effect.mapError((cause) => new DiagramDiscoveryError({ path: dir, cause })))

          for (const entry of entries) {
            const fullPath = path.join(dir, entry)
            const info = yield* fs
              .stat(fullPath)
              .pipe(Effect.mapError((cause) => new DiagramDiscoveryError({ path: fullPath, cause })))

            if (info.type === 'Directory') {
              yield* walk(fullPath)
            } else if (info.type === 'File' && entry.endsWith('.tldr')) {
              results.push(fullPath)
            }
          }
        })

      const rootExists = yield* fs
        .exists(diagramsRoot)
        .pipe(Effect.mapError((cause) => new DiagramDiscoveryError({ path: diagramsRoot, cause })))

      if (!rootExists) {
        return []
      }

      yield* walk(diagramsRoot)

      yield* Effect.annotateCurrentSpan({ diagramCount: results.length })

      return results
    }),
  )

/** Build all diagrams, rendering to SVG and caching */
export const buildDiagrams = (
  options: BuildDiagramsOptions,
): Effect.Effect<void, BuildDiagramsError, FileSystem.FileSystem> =>
  Effect.withSpan('tldraw.build-diagrams')(
    Effect.gen(function* () {
      const { projectRoot, verbose = false } = options
      const paths = resolveCachePaths(projectRoot)
      const fs = yield* FileSystem.FileSystem

      if (verbose) {
        yield* Effect.log('Building tldraw diagrams...')
        yield* Effect.log(`  Diagrams root: ${paths.diagramsRoot}`)
        yield* Effect.log(`  Cache root: ${paths.cacheRoot}`)
      }

      /* Discover all .tldr files */
      const diagramFiles = yield* discoverDiagramFiles(paths.diagramsRoot)

      if (diagramFiles.length === 0) {
        if (verbose) {
          yield* Effect.log('  No .tldr files found')
        }
        /* Still save an empty manifest */
        yield* saveManifest(paths.manifestPath, { entries: [], version: '1.0.0' })
        return
      }

      if (verbose) {
        yield* Effect.log(`  Found ${diagramFiles.length} diagram(s)`)
      }

      /* Load existing manifest */
      const manifest = yield* loadManifest(paths.manifestPath)

      /* Create temporary directory for rendering */
      const tempDir = yield* fs
        .makeTempDirectory({ directory: os.tmpdir(), prefix: 'tldraw-render-' })
        .pipe(Effect.mapError((cause) => new FileSystemError({ path: paths.cacheRoot, operation: 'mkdtemp', cause })))

      try {
        /* Process each diagram */
        let updatedManifest = manifest
        let renderedCount = 0
        let skippedCount = 0

        for (const diagramPath of diagramFiles) {
          const entryFile = path.relative(paths.diagramsRoot, diagramPath).replace(/\\/g, '/')

          /* Check if we need to re-render */
          const { hash: sourceHash } = yield* readTldrawFile(diagramPath)
          const existingEntry = getCacheEntry(manifest, entryFile)

          if (isCacheValid(existingEntry, sourceHash)) {
            if (verbose) {
              yield* Effect.log(`  ✓ ${entryFile} (cached)`)
            }
            skippedCount++
            continue
          }

          if (verbose) {
            yield* Effect.log(`  ⟳ ${entryFile} (rendering...)`)
          }

          /* Render to SVG */
          const renderResult = yield* renderTldrawToSvg(diagramPath, tempDir)

          /* Extract dimensions */
          const dimensions = getSvgDimensions(renderResult.lightSvg)

          /* Build metadata with proper type handling */
          const metadata:
            | {
                width?: number
                height?: number
              }
            | undefined =
            dimensions?.width !== undefined && dimensions?.height !== undefined
              ? { width: dimensions.width, height: dimensions.height }
              : dimensions?.width !== undefined
                ? { width: dimensions.width }
                : dimensions?.height !== undefined
                  ? { height: dimensions.height }
                  : undefined

          /* Save to cache */
          const entry = yield* saveDiagramToCache(paths, entryFile, renderResult, metadata)

          /* Update manifest */
          updatedManifest = updateManifestEntry(updatedManifest, entry)

          if (verbose) {
            yield* Effect.log(`    ✓ ${entryFile}`)
          }
          renderedCount++
        }

        /* Save updated manifest */
        yield* saveManifest(paths.manifestPath, updatedManifest)

        if (verbose) {
          yield* Effect.log(`\n  Summary:`)
          yield* Effect.log(`    Rendered: ${renderedCount}`)
          yield* Effect.log(`    Cached: ${skippedCount}`)
          yield* Effect.log(`    Total: ${diagramFiles.length}`)
        }
      } finally {
        /* Clean up temp directory */
        yield* fs.remove(tempDir, { recursive: true, force: true }).pipe(Effect.catchAll(() => Effect.void))
      }
    }),
  )
