import * as http from 'node:http'

import { NodeFileSystem } from '@effect/platform-node'
import { Effect, FileSystem, Layer, Option } from 'effect'

import { OtelTracer, Tracer, UnknownError } from '../effect/mod.ts'
import { makeNoopTracer } from '../NoopTracer.ts'

export * as Cli from 'effect/unstable/cli'
export * as SocketServer from 'effect/unstable/socket/SocketServer'
export * as PlatformNode from '@effect/platform-node'

// Enable debug logging for OpenTelemetry
// otel.diag.setLogger(new otel.DiagConsoleLogger(), otel.DiagLogLevel.ERROR)

// export const OtelLiveHttp = (args: any): Layer.Layer<never> => Layer.empty

export const getFreePort: Effect.Effect<number, UnknownError> = Effect.callback<number, UnknownError>((cb, signal) => {
  const server = http.createServer()

  signal.addEventListener('abort', () => {
    server.close()
  })

  // Listen on port 0 to get an available port
  server.listen(0, () => {
    const address = server.address()

    if (address !== null && typeof address === 'object') {
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

  const TracingLive = OtelTracer.layerWithoutOtelTracer.pipe(
    Layer.provideMerge(OtelTracerLive),
  )

  return TracingLive
})

/**
 * Compatibility layer for the old Effect v3 @parcel/watcher backend.
 *
 * Effect v4 removed `@effect/platform-node/NodeFileSystem/ParcelWatcher`; its
 * NodeFileSystem layer now performs recursive watching through Node's native
 * `fs.watch(path, { recursive: true })` fallback. This layer deliberately
 * registers no custom backend so existing `NodeRecursiveWatchLayer` consumers
 * continue to compile while the v4 NodeFileSystem implementation handles watch
 * events.
 *
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
export const NodeRecursiveWatchLayer: Layer.Layer<FileSystem.WatchBackend> = Layer.succeed(
  FileSystem.WatchBackend,
  FileSystem.WatchBackend.of({
    register: () => Option.none(),
  }),
)

/**
 * Pre-composed layer providing FileSystem with recursive file watching.
 * This is the recommended way to get a FileSystem that supports recursive watching.
 *
 * Use this layer when you need to watch files recursively (e.g., watching nested directories).
 * Effect v4's NodeFileSystem uses Node.js's native recursive `fs.watch` support
 * instead of the removed ParcelWatcher backend from Effect v3.
 */
export { NodeFileSystem } from '@effect/platform-node'

export const NodeFileSystemWithWatch = NodeFileSystem.layer.pipe(Layer.provideMerge(NodeRecursiveWatchLayer))
