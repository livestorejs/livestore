import * as http from 'node:http'

import { Effect, Layer } from 'effect'

import { OtelTracer, UnknownError } from '../effect/index.ts'
import { makeNoopTracer } from '../NoopTracer.ts'

export * as Cli from '@effect/cli'
export * as SocketServer from '@effect/platform/SocketServer'
export * as PlatformNode from '@effect/platform-node'

export * as ChildProcessRunner from './ChildProcessRunner/ChildProcessRunner.ts'
export * as ChildProcessWorker from './ChildProcessRunner/ChildProcessWorker.ts'

// Enable debug logging for OpenTelemetry
// otel.diag.setLogger(new otel.DiagConsoleLogger(), otel.DiagLogLevel.ERROR)

// export const OtelLiveHttp = (args: any): Layer.Layer<never> => Layer.empty

export const getFreePort = Effect.async<number, UnknownError>((cb, signal) => {
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
  server.on('error', (err) => {
    server.close(() => cb(Effect.fail(new UnknownError({ cause: err }))))
  })
})

export const OtelLiveDummy: Layer.Layer<OtelTracer.OtelTracer> = Layer.suspend(() => {
  const OtelTracerLive = Layer.succeed(OtelTracer.OtelTracer, makeNoopTracer())

  const TracingLive = Layer.unwrapEffect(Effect.map(OtelTracer.make, Layer.setTracer)).pipe(
    Layer.provideMerge(OtelTracerLive),
  )

  return TracingLive
})
