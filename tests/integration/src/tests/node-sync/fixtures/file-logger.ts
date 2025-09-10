import * as fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { shouldNeverHappen, sluggify } from '@livestore/utils'
import {
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  Layer,
  Logger,
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSerialization,
  RpcServer,
  Schema,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { FileLogger } from '@livestore/utils-dev/node'
import type { Vitest } from '@livestore/utils-dev/node-vitest'

/*
 * ## Why is this custom file logger needed?
 *
 * We're using this custom file logger to better control logging outputs. In the past we piped all
 * output to stdout. But given the output can easily reach >10k lines it was hard to read and also
 * polluted LLM context when debugging.
 *
 * We then tried using Vitest reporters to capture the output and write it to a file but that also
 * didn't work well due to Vitest only capturing `console.log` / `console.error` and not `console.debug`
 * or `console.info`.
 *
 * So in the end we rolled our own file logger using Effect's `Logger` system. Given we're using a
 * multi-threaded setup we needed a way to send the logs across threads and capture them in a single
 * place. That's what the system below does.
 *
 * ## How does it work?
 * - In the test runner we start an RPC server that listens for log messages which writes to a file.
 * - Each thread sends its logs to the RPC server via HTTP.
 *
 * ## Notes
 * - We've decided to write to a single cannonical file for each test. Make sure to not run multiple
 *   tests in parallel which would cause the log to be messed up.
 */

class LoggerRpcs extends RpcGroup.make(
  Rpc.make('LogMessage', {
    payload: {
      message: Schema.String,
    },
    success: Schema.Void,
  }),
) {}

export const makeFileLogger = (threadName: string, exposeTestContext?: { testContext: Vitest.TestContext }) =>
  Layer.suspend(() => {
    if (exposeTestContext !== undefined) {
      const spanName = `${exposeTestContext.testContext.task.suite?.name}:${exposeTestContext.testContext.task.name}`
      const testRunId = sluggify(spanName)

      process.env.TEST_RUN_ID = testRunId

      const serverPort = Math.floor(Math.random() * 10_000) + 50_000
      process.env.LOGGER_SERVER_PORT = String(serverPort)

      return Layer.provide(makeRpcClient(threadName), RpcLogger(testRunId, serverPort))
    } else {
      return makeRpcClient(threadName)
    }
  })

export const RpcLogger = (testRunId: string, serverPort: number) =>
  Effect.gen(function* () {
    const workspaceRoot = process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
    const logFilePath = path.join(workspaceRoot, 'tests', 'integration', 'tmp', 'logs', `${testRunId}.log`)

    console.log(`Logs for ${testRunId} will be written to ${logFilePath}`)

    yield* Effect.promise(() => fs.mkdir(path.dirname(logFilePath), { recursive: true }))

    const fileHandle = yield* Effect.acquireRelease(
      Effect.promise(() => fs.open(logFilePath, 'w')), // overwrite the file to start fresh
      (fileHandle) => Effect.promise(() => fileHandle.close()),
    )

    const LoggerHandlers = LoggerRpcs.toLayer(
      Effect.succeed({
        LogMessage: ({ message }) => Effect.promise(() => fs.appendFile(fileHandle, message)),
      }),
    )

    const RpcLayer = RpcServer.layer(LoggerRpcs).pipe(Layer.provide(LoggerHandlers))

    const HttpProtocol = RpcServer.layerProtocolHttp({
      path: '/rpc',
    }).pipe(Layer.provide(RpcSerialization.layerNdjson))

    // Use the provided port
    // Add basic server lifecycle diagnostics
    const serverFactory = () => {
      const server = createServer()
      // Track sockets to diagnose keep-alive / lingering connections
      const sockets = new Set<import('node:net').Socket>()
      server.on('connection', (socket) => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
      })
      server.on('listening', () =>
        console.log(`[diag][file-logger] HTTP server listening on ${serverPort} (${testRunId})`),
      )
      server.on('close', () => console.log(`[diag][file-logger] HTTP server closed (${testRunId})`))
      server.on('error', (err) => console.log(`[diag][file-logger] HTTP server error`, err))
      // Periodic report (low frequency) in case of long runs
      const interval = setInterval(() => {
        if (sockets.size > 0) {
          console.log(`[diag][file-logger] open sockets=${sockets.size} (${testRunId})`)
        }
      }, 5000)
      server.on('close', () => clearInterval(interval))
      return server
    }

    // Log when the logger layer scope is torn down
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => console.log(`[diag][file-logger] finalizer for ${testRunId}`)),
    )

    return HttpRouter.Default.serve().pipe(
      Layer.provide(RpcLayer),
      Layer.provide(HttpProtocol),
      Layer.provide(PlatformNode.NodeHttpServer.layer(serverFactory, { port: serverPort })),
    )
  }).pipe(Layer.unwrapScoped, Layer.orDie)

export const makeRpcClient = (threadName: string) => {
  const prettyLogger = FileLogger.prettyLoggerTty({
    colors: false,
    stderr: false,
    formatDate: (date) => `${FileLogger.defaultDateFormat(date)} ${threadName}`,
  })

  return Logger.replaceScoped(
    Logger.defaultLogger,
    Effect.gen(function* () {
      const serverPort = process.env.LOGGER_SERVER_PORT ?? shouldNeverHappen('LOGGER_SERVER_PORT is not set')
      const baseUrl = `http://localhost:${serverPort}`

      const disableKeepAlive = (process.env.LOGGER_DISABLE_KEEP_ALIVE ?? '1') !== '0'

      const ProtocolLive = RpcClient.layerProtocolHttp({
        url: `${baseUrl}/rpc`,
        // Avoid HTTP keep-alive unless explicitly disabled via env toggle
        transformClient: HttpClient.mapRequest((request) =>
          disableKeepAlive
            ? request.pipe(HttpClientRequest.setHeader('connection', 'close'))
            : request,
        ),
      }).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]))

      const client = yield* RpcClient.make(LoggerRpcs).pipe(Effect.provide(ProtocolLive))

      const runtime = yield* Effect.runtime<never>()

      return Logger.make((args) => {
        const formattedMessage = prettyLogger.log(args)
        return client.LogMessage({ message: formattedMessage }).pipe(
          Effect.provide(runtime),
          Effect.catchAll(() => Effect.void),
          Effect.runFork,
        )
      })
    }),
  )
}
