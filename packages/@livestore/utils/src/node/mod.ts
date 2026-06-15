import * as http from 'node:http'

import { NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'

import { OtelTracer, UnknownError } from '../effect/mod.ts'
import { makeNoopTracer } from '../NoopTracer.ts'

export * as Cli from 'effect/unstable/cli'
export * as SocketServer from 'effect/unstable/socket/SocketServer'
export * as PlatformNode from '@effect/platform-node'

export * as ChildProcessRunner from './ChildProcessRunner/ChildProcessRunner.ts'
export * as ChildProcessWorker from './ChildProcessRunner/ChildProcessWorker.ts'
export { NodeFileSystem }

/**
 * v4 no longer exposes the old ParcelWatcher layer. Keep the facade export in
 * place so downstream packages can migrate separately from the Effect package
 * layout change.
 */
export const NodeRecursiveWatchLayer = Layer.empty

export const NodeFileSystemWithWatch = NodeFileSystem.layer.pipe(Layer.provideMerge(NodeRecursiveWatchLayer))

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

  return OtelTracer.layerWithoutOtelTracer.pipe(Layer.provideMerge(OtelTracerLive))
})
