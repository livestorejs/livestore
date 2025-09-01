import http from 'node:http'
import path from 'node:path'
import { UnexpectedError } from '@livestore/common'
import type { LiveStoreEvent } from '@livestore/livestore'
import { Schema } from '@livestore/livestore'
import * as ElectricSync from '@livestore/sync-electric'
import {
  type CommandExecutor,
  Effect,
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Layer,
  type PlatformError,
} from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'
import { type CmdError, pullDockerComposeImages, startDockerComposeServices } from '@livestore/utils-dev/node'
import postgres from 'postgres'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'

// Also support scenarios where Docker is not running locally but via a Docker remote context (@schickling needs this)
const dockerHostName = process.env.DOCKER_CONTEXT ?? 'localhost'

export const name = 'ElectricSQL'

export const prepare: Effect.Effect<void, PlatformError.PlatformError | CmdError, CommandExecutor.CommandExecutor> =
  pullDockerComposeImages({
    cwd: path.join(import.meta.dirname, 'electric'),
  }).pipe(Effect.withSpan('electric-provider:prepare'))

export const layer: SyncProviderLayer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { endpointPort } = yield* startElectricApi

    return {
      makeProvider: ElectricSync.makeSyncBackend({ endpoint: `http://localhost:${endpointPort}` }),
      turnBackendOffline: Effect.log('TODO implement turnBackendOffline'),
      turnBackendOnline: Effect.log('TODO implement turnBackendOnline'),
      push: () => Effect.log('TODO implement push'),
    }
  }),
).pipe(UnexpectedError.mapToUnexpectedErrorLayer)

const startElectricApi = Effect.gen(function* () {
  const electricPort = yield* getFreePort
  const postgresPort = yield* getFreePort

  // Start Docker Compose services (postgres + electric)
  const healthCheckUrl = `http://${dockerHostName}:${electricPort}/v1/health`
  yield* Effect.logDebug('Health check URL:', healthCheckUrl)
  yield* Effect.logDebug('Electric port:', electricPort)
  yield* Effect.logDebug('Postgres port:', postgresPort)

  yield* startDockerComposeServices({
    cwd: path.join(import.meta.dirname, 'electric'),
    env: {
      ELECTRIC_PORT: electricPort.toString(),
      POSTGRES_PORT: postgresPort.toString(),
    },
    healthCheck: { url: healthCheckUrl },
    // forwardLogs: true,
  })

  // Get a free port for our HTTP API server
  const endpointPort = yield* getFreePort

  // Start the HTTP server in the background
  yield* makeRouter({ electricPort, postgresPort }).pipe(
    // HttpMiddleware.logger, // Can be useful for debugging
    HttpServer.serve(),
    Layer.provide(PlatformNode.NodeHttpServer.layer(() => http.createServer(), { port: endpointPort })),
    Layer.launch,
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )

  return { endpointPort }
}).pipe(Effect.withSpan('electric-provider:startElectricApi'))

const makeRouter = ({ electricPort, postgresPort }: { electricPort: number; postgresPort: number }) => {
  const electricHost = `http://${dockerHostName}:${electricPort}`
  const apiSecret = 'change-me-electric-secret'

  return HttpRouter.empty.pipe(
    // GET / (pull)
    HttpRouter.get(
      '/',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        const { url, storeId, needsInit /* payload */ } = ElectricSync.makeElectricUrl({
          electricHost,
          searchParams: new URL(request.url, `http://localhost`).searchParams,
          apiSecret,
        })

        // Validate auth token (for testing purposes)
        // if ((payload as any)?.authToken !== 'insecure-token-change-me') {
        //   return yield* HttpServerResponse.json({ error: 'Invalid auth token' }).pipe(
        //     Effect.andThen(HttpServerResponse.setStatus(401)),
        //   )
        // }

        if (needsInit) {
          const db = makeDb({ storeId, postgresPort })
          yield* db.migrate
          yield* db.disconnect
        }

        const electricResponse = yield* HttpClient.get(url)

        return yield* HttpServerResponse.stream(electricResponse.stream, {
          headers: electricResponse.headers,
          status: electricResponse.status,
        })
      }),
    ),

    // POST / (push)
    HttpRouter.post(
      '/',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = yield* request.json
        const parsedPayload = yield* Schema.decodeUnknown(ElectricSync.ApiSchema.PushPayload)(body)

        const db = makeDb({ storeId: parsedPayload.storeId, postgresPort })

        yield* db.migrate
        yield* db.createEvents(parsedPayload.batch)
        yield* db.disconnect

        return yield* HttpServerResponse.json({ success: true })
      }),
    ),

    // HEAD / (ping)
    HttpRouter.head(
      '/',
      Effect.gen(function* () {
        const electricResponse = yield* HttpClient.head(electricHost)

        return yield* HttpServerResponse.empty().pipe(
          HttpServerResponse.setStatus(electricResponse.status),
          HttpServerResponse.setHeaders(electricResponse.headers),
        )
      }),
    ),
  )
}

const makeDb = ({ storeId, postgresPort }: { storeId: string; postgresPort: number }) => {
  const tableName = ElectricSync.toTableName(storeId)

  const sql = postgres({
    database: 'electric',
    user: 'postgres',
    password: 'password',
    host: dockerHostName,
    port: postgresPort,
  })

  const migrate = Effect.tryPromise(
    () =>
      sql`
    CREATE TABLE IF NOT EXISTS ${sql(tableName)} (
      "seqNum" INTEGER PRIMARY KEY,
      "parentSeqNum" INTEGER,
      "name" TEXT NOT NULL,
      "args" JSONB NOT NULL,
      "clientId" TEXT NOT NULL,
      "sessionId" TEXT NOT NULL
    )
  `,
  ).pipe(Effect.withSpan('electric-provider:migrate'))

  const createEvents = (events: ReadonlyArray<LiveStoreEvent.AnyEncodedGlobal>) =>
    Effect.tryPromise(async () => {
      // For postgres library, we need to use the exact column names as properties
      // Since our columns are quoted in the CREATE TABLE, we need to match them
      for (const event of events) {
        await sql`
          INSERT INTO ${sql(tableName)} ("seqNum", "parentSeqNum", "name", "args", "clientId", "sessionId")
          VALUES (${event.seqNum}, ${event.parentSeqNum}, ${event.name}, ${sql.json(event.args)}, ${event.clientId}, ${event.sessionId})
        `
      }
    }).pipe(Effect.withSpan('electric-provider:createEvents'))

  const disconnect = Effect.tryPromise(() => sql.end()).pipe(Effect.withSpan('electric-provider:disconnect'))

  return { migrate, createEvents, disconnect }
}
