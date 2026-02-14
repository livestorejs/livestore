import os from 'node:os'
import path from 'node:path'

import { type Duration, Effect, FileSystem, type PlatformError, Schema, Stream } from '@livestore/utils/effect'
import { NodeFileSystemWithWatch } from '@livestore/utils/node'

import {
  FileSystemError,
  getCacheEntry,
  isCacheValid,
  loadManifest,
  resolveCachePaths,
  saveDiagramToCache,
  saveManifest,
  type TldrawCachePaths,
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Watch Mode Implementation
 * ───────────────────────────────────────────────────────────────────────────── */

const DEFAULT_WATCH_DEBOUNCE: Duration.DurationInput = '300 millis'

type WatchEventSummary = {
  absolutePath: string
  relativePath: string
  kind: FileSystem.WatchEvent['_tag']
}

export type WatchDiagramsRebuildInfo = {
  reason: 'initial' | 'watch'
  event: WatchEventSummary | null
  renderedCount: number
  durationMs: number
}

type NormalizedWatchOptions = {
  debounce: Duration.DurationInput
  initialBuild: boolean
  onRebuild: (info: WatchDiagramsRebuildInfo) => Effect.Effect<void>
}

export type WatchDiagramsOptions = BuildDiagramsOptions & {
  debounce?: Duration.DurationInput
  /**
   * Run an initial build on startup before processing watch events.
   *
   * Useful to disable when the caller already ran `buildDiagrams` and only wants incremental rebuilds.
   */
  initialBuild?: boolean
  onRebuild?: (info: WatchDiagramsRebuildInfo) => Effect.Effect<void>
}

const toPosix = (value: string): string => value.replace(/\\/g, '/')

const isWithinDirectory = (candidate: string, directory: string): boolean => {
  const normalizedDirectory = path.resolve(directory)
  const normalizedCandidate = path.resolve(candidate)
  return (
    normalizedCandidate === normalizedDirectory || normalizedCandidate.startsWith(`${normalizedDirectory}${path.sep}`)
  )
}

/** Summarize a watch event, filtering out non-.tldr files and cache directory changes */
const summarizeWatchEvent = (paths: TldrawCachePaths, event: FileSystem.WatchEvent): WatchEventSummary | null => {
  const rootAbsolute = path.resolve(paths.diagramsRoot)
  const rawPath = event.path
  const absolutePath = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.join(rootAbsolute, rawPath))

  /* Ignore events inside cache directory */
  if (isWithinDirectory(absolutePath, paths.cacheRoot)) {
    return null
  }

  /* Ignore events outside diagrams root */
  if (!isWithinDirectory(absolutePath, rootAbsolute)) {
    return null
  }

  /* Only watch .tldr files */
  if (!absolutePath.endsWith('.tldr')) {
    return null
  }

  const relativeRaw = path.relative(rootAbsolute, absolutePath)
  const relativePath = relativeRaw.length === 0 ? '.' : toPosix(relativeRaw)

  return {
    absolutePath,
    relativePath,
    kind: event._tag,
  }
}

/** Create a filtered watch stream for .tldr files */
const createWatchStream = (
  fs: FileSystem.FileSystem,
  paths: TldrawCachePaths,
): Stream.Stream<WatchEventSummary, PlatformError.PlatformError> =>
  fs.watch(paths.diagramsRoot).pipe(
    Stream.map((event) => summarizeWatchEvent(paths, event)),
    Stream.filter((summary): summary is WatchEventSummary => summary !== null),
  )

const normalizeWatchOptions = (
  options: Partial<Pick<WatchDiagramsOptions, 'debounce' | 'initialBuild' | 'onRebuild'>> = {},
): NormalizedWatchOptions => ({
  debounce: options.debounce ?? DEFAULT_WATCH_DEBOUNCE,
  initialBuild: options.initialBuild ?? true,
  onRebuild: options.onRebuild ?? (() => Effect.void),
})

/** Internal watch implementation with queue-based sequential processing */
const watchDiagramsInternal = (
  options: BuildDiagramsOptions,
  watchOptions: NormalizedWatchOptions,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = resolveCachePaths(options.projectRoot)

    const diagramsRootExists = yield* fs.exists(paths.diagramsRoot).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (!diagramsRootExists) {
      yield* Effect.logWarning(`Diagrams watch: diagrams root does not exist at ${paths.diagramsRoot}`)
      return yield* Effect.never
    }

    const notify = (info: WatchDiagramsRebuildInfo) => watchOptions.onRebuild(info)

    const runRebuild = (reason: WatchDiagramsRebuildInfo['reason'], event: WatchEventSummary | null) =>
      Effect.gen(function* () {
        const startedAt = Date.now()
        if (event) {
          yield* Effect.log(`Diagrams watch: ${event.kind.toLowerCase()} at ${event.relativePath}, rebuilding...`)
        } else {
          yield* Effect.log('Diagrams watch: running initial build')
        }

        const result = yield* buildDiagrams(options).pipe(Effect.either)
        const durationMs = Date.now() - startedAt

        if (result._tag === 'Left') {
          const error = result.left
          yield* Effect.logError(
            `Diagrams watch: build failed${event ? ` (trigger: ${event.relativePath})` : ''}: ${error.message}`,
          )
          yield* notify({ reason, event, renderedCount: -1, durationMs })
          return
        }

        yield* Effect.log(`Diagrams watch: completed in ${durationMs}ms`)
        yield* notify({ reason, event, renderedCount: 0, durationMs })
      })

    /* Initial build */
    if (watchOptions.initialBuild) {
      yield* runRebuild('initial', null)
    }

    /* Set up watch stream with debounce */
    const watchStream = createWatchStream(fs, paths)
    const debouncedStream = Stream.debounce(watchOptions.debounce)(watchStream)

    /* Process events sequentially via mapEffect with concurrency 1 */
    const streamEffect = debouncedStream.pipe(
      Stream.mapEffect((event) => runRebuild('watch', event), { concurrency: 1 }),
      Stream.runDrain,
    )

    yield* streamEffect.pipe(
      Effect.catchAll((cause) =>
        Effect.logWarning(`Diagrams watch: stream failed with ${String(cause)}`).pipe(Effect.zipRight(Effect.never)),
      ),
    )
  })

/** Watch diagrams directory for changes and rebuild on modifications */
export const watchDiagrams = (options: WatchDiagramsOptions): Effect.Effect<void> => {
  const { debounce, initialBuild, onRebuild, ...baseOptions } = options
  const normalizedWatch = normalizeWatchOptions({
    ...(debounce !== undefined ? { debounce } : {}),
    ...(initialBuild !== undefined ? { initialBuild } : {}),
    ...(onRebuild !== undefined ? { onRebuild } : {}),
  })
  return watchDiagramsInternal(baseOptions, normalizedWatch).pipe(
    Effect.withSpan('tldraw.watch-diagrams'),
    /**
     * Must use NodeFileSystemWithWatch to ensure recursive file watching works correctly.
     * @see https://github.com/Effect-TS/effect/issues/5913
     */
    Effect.provide(NodeFileSystemWithWatch),
  )
}

/** Exported for testing */
export const __internal = {
  summarizeWatchEvent,
  createWatchStream,
  DEFAULT_WATCH_DEBOUNCE,
}
