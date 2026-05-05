import * as http from 'node:http'

import { Effect, Layer, Tracer } from 'effect'

import { OtelTracer, UnknownError } from '../effect/mod.ts'
import { makeNoopTracer } from '../NoopTracer.ts'

import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
export * as Cli from 'effect/unstable/cli'
export * as SocketServer from 'effect/unstable/socket/SocketServer'

export * as ChildProcessRunner from './ChildProcessRunner/ChildProcessRunner.ts'
export * as ChildProcessWorker from './ChildProcessRunner/ChildProcessWorker.ts'

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

  const TracingLive = Layer.effect(Tracer.Tracer, OtelTracer.make).pipe(
    Layer.provideMerge(OtelTracerLive),
  )

  return TracingLive
})

/**
 * v4 no longer exposes the old ParcelWatcher add-on layer. Keep this export as
 * a no-op compatibility layer for local callers that compose it explicitly.
 */
export const NodeRecursiveWatchLayer = Layer.empty

/**
 * Pre-composed layer providing FileSystem with recursive file watching via @parcel/watcher.
 * This is the recommended way to get a FileSystem that supports recursive watching.
 *
 * Use this layer when you need to watch files recursively (e.g., watching nested directories).
 * Without recursive watching, Node.js's built-in fs.watch only detects changes in the
 * immediate directory, not in subdirectories.
 */
export * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'


export const NodeFileSystemWithWatch = NodeFileSystem.layer
