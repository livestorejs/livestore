import * as http from 'node:http'
import { layer as ParcelWatcherLayer } from '@effect/platform-node/NodeFileSystem/ParcelWatcher'
import { Effect, Layer } from 'effect'
import { OtelTracer, UnknownError } from '../effect/mod.ts'
import { makeNoopTracer } from '../NoopTracer.ts'

export * as Cli from '@effect/cli'
export * as SocketServer from '@effect/platform/SocketServer'
export * as PlatformNode from '@effect/platform-node'

export * as ChildProcessRunner from './ChildProcessRunner/ChildProcessRunner.ts'
export * as ChildProcessWorker from './ChildProcessRunner/ChildProcessWorker.ts'

// Enable debug logging for OpenTelemetry
// otel.diag.setLogger(new otel.DiagConsoleLogger(), otel.DiagLogLevel.ERROR)

// export const OtelLiveHttp = (args: any): Layer.Layer<never> => Layer.empty

export const getFreePort: Effect.Effect<number, UnknownError> = Effect.async<number, UnknownError>((cb, signal) => {
  const server = http.createServer()

  signal.addEventListener('abort', () => {
    server.close()
  })

  // Listen on port 0 to get an available port
  server.listen(0, () => {
    const address = server.address()

    if (address && typeof address === 'object') {
      const port = address.port
      server.close(() => cb(Effect.succeed(port)))
    } else {
      server.close(() => cb(Effect.fail(new UnknownError({ cause: 'Failed to get a free port' }))))
    }
  })

  // Error handling in case the server encounters an error
  server.on('error', (cause) => {
    server.close(() => cb(Effect.fail(new UnknownError({ cause, payload: 'Failed to get a free port' }))))
  })
})

export const OtelLiveDummy: Layer.Layer<OtelTracer.OtelTracer> = Layer.suspend(() => {
  const OtelTracerLive = Layer.succeed(OtelTracer.OtelTracer, makeNoopTracer())

  const TracingLive = Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
    Layer.provideMerge(OtelTracerLive),
  )

  return TracingLive
})

/**
 * Layer that provides WatchBackend for recursive file watching via @parcel/watcher.
 * This layer alone does NOT provide FileSystem - it only provides the watch backend.
 *
 * IMPORTANT: Layer ordering matters! When composing with NodeFileSystem.layer, use
 * `NodeFileSystemWithWatch` instead, or ensure WatchBackend is available when FileSystem
 * is constructed by using `Layer.provideMerge`:
 *
 * ```ts
 * // ✅ CORRECT: Use the pre-composed layer
 * Effect.provide(NodeFileSystemWithWatch)
 *
 * // ✅ CORRECT: Manual composition with Layer.provideMerge
 * const layer = PlatformNode.NodeFileSystem.layer.pipe(Layer.provideMerge(NodeRecursiveWatchLayer))
 * Effect.provide(layer)
 *
 * // ❌ WRONG: Chained Effect.provide - WatchBackend won't be used!
 * Effect.provide(NodeRecursiveWatchLayer).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))
 * ```
 *
 * @see https://github.com/Effect-TS/effect/issues/5913
 */
export const NodeRecursiveWatchLayer = ParcelWatcherLayer

/**
 * Pre-composed layer providing FileSystem with recursive file watching via @parcel/watcher.
 * This is the recommended way to get a FileSystem that supports recursive watching.
 *
 * Use this layer when you need to watch files recursively (e.g., watching nested directories).
 * Without recursive watching, Node.js's built-in fs.watch only detects changes in the
 * immediate directory, not in subdirectories.
 */
export { NodeFileSystem } from '@effect/platform-node'

import { NodeFileSystem } from '@effect/platform-node'

export const NodeFileSystemWithWatch = NodeFileSystem.layer.pipe(Layer.provideMerge(ParcelWatcherLayer))
