import http from 'node:http'
import path from 'node:path'
import type { LiveStoreEvent } from '@livestore/livestore'
import { Schema } from '@livestore/livestore'
import * as ElectricSync from '@livestore/sync-electric'
import {
  Effect,
  HttpClient,
  HttpClientRequest,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Layer,
} from '@livestore/utils/effect'
import { getFreePort, PlatformNode } from '@livestore/utils/node'
import { startDockerComposeServices } from '@livestore/utils-dev/node-vitest'
import postgres from 'postgres'
import { SyncProviderImpl } from '../types.ts'

// Also support scenarios where Docker is not running locally but via a Docker remote context
const dockerHostName = process.env.DOCKER_CONTEXT ?? 'localhost'

export const name = 'ElectricSQL'

export const layer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const { endpointPort } = yield* startElectricApi

    return {
      makeProvider: ElectricSync.makeSyncBackend({ endpoint: `http://localhost:${endpointPort}` }),
    }
  }),
)

const startElectricApi = Effect.gen(function* () {
  const electricPort = yield* getFreePort
  const postgresPort = yield* getFreePort

  // Start Docker Compose services (postgres + electric)
  yield* startDockerComposeServices({
    cwd: path.join(import.meta.dirname, 'electric'),
    env: {
      ELECTRIC_PORT: electricPort.toString(),
      POSTGRES_PORT: postgresPort.toString(),
    },
    healthCheck: { url: `http://${dockerHostName}:${electricPort}/v1/health` },
    // forwardLogs: true,
  })

  // Get a free port for our HTTP API server
  const endpointPort = yield* getFreePort

  // Start the HTTP server in the background
  yield* makeRouter({ electricPort, postgresPort }).pipe(
    HttpMiddleware.logger,
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

        const { url, storeId, needsInit, payload } = ElectricSync.makeElectricUrl({
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

        // Don't create table on GET - let Electric handle non-existent tables
        // The table should only be created when we have data to insert (via POST)
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
