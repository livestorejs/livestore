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
import { PlatformNode } from '@livestore/utils/node'
import { FileLogger } from '@livestore/utils-dev/node'
import type { Vitest } from '@livestore/utils-dev/node-vitest'

/**
 * RPC Schema for logging operations
 */
class LoggerRpcs extends RpcGroup.make(
  Rpc.make('LogMessage', {
    payload: {
      message: Schema.String,
    },
    success: Schema.Void,
  }),
) {}

/**
 * Creates a logger layer with support for different modes:
 * - 'file': Traditional file logging (current behavior)
 * - 'rpc': Sends logs via HTTP RPC to centralized logger
 * - 'centralized': Receives RPC logs and writes to single file (runner only)
 */
export const makeFileLogger = (threadName: string, exposeTestContext?: { testContext: Vitest.TestContext }) =>
  Layer.suspend(() => {
    if (exposeTestContext !== undefined) {
      const spanName = `${exposeTestContext.testContext.task.suite?.name}:${exposeTestContext.testContext.task.name}`
      const testRunId = sluggify(spanName)

      process.env.TEST_RUN_ID = testRunId

      const serverPort = Math.floor(Math.random() * 10000) + 50000
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
    return HttpRouter.Default.serve().pipe(
      Layer.provide(RpcLayer),
      Layer.provide(HttpProtocol),
      Layer.provide(PlatformNode.NodeHttpServer.layer(() => createServer(), { port: serverPort })),
    )
  }).pipe(Layer.unwrapScoped)

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

      // yield* Effect.sleep(500)

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
