import * as fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { shouldNeverHappen, sluggify } from '@livestore/utils'
import {
  Effect,
  FetchHttpClient,
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
import { PlatformNode, getFreePort } from '@livestore/utils/node'
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

      return Layer.unwrapScoped(
        Effect.gen(function* () {
          const port = yield* getFreePort

          process.env.TEST_RUN_ID = testRunId
          process.env.LOGGER_SERVER_PORT = String(port)

          return Layer.provide(makeRpcClient(threadName), RpcLogger(testRunId, port))
        }),
      )
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
    return HttpRouter.Default.serve().pipe(
      Layer.provide(RpcLayer),
      Layer.provide(HttpProtocol),
      Layer.provide(PlatformNode.NodeHttpServer.layer(() => createServer(), { port: serverPort })),
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

      const ProtocolLive = RpcClient.layerProtocolHttp({
        url: `${baseUrl}/rpc`,
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
