import { makeColumnSpec, UnexpectedError } from '@livestore/common'
import { DbSchema, EventId, type MutationEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Logger, LogLevel, Option, Schema } from '@livestore/utils/effect'
import { DurableObject } from 'cloudflare:workers'

import { WSMessage } from '../common/mod.js'
import type { SyncMetadata } from '../common/ws-message-types.js'

export interface Env {
  WEBSOCKET_SERVER: DurableObjectNamespace
  DB: D1Database
  ADMIN_SECRET: string
}

type WebSocketClient = WebSocket

const encodeOutgoingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.BackendToClientMessage))
const encodeIncomingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.ClientToBackendMessage))
const decodeIncomingMessage = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.ClientToBackendMessage))

// NOTE actual table name is determined at runtime
export const mutationLogTable = DbSchema.table('mutation_log_${PERSISTENCE_FORMAT_VERSION}_${storeId}', {
  id: DbSchema.integer({ primaryKey: true, schema: EventId.GlobalEventId }),
  parentId: DbSchema.integer({ schema: EventId.GlobalEventId }),
  mutation: DbSchema.text({}),
  args: DbSchema.text({ schema: Schema.parseJson(Schema.Any) }),
  /** ISO date format. Currently only used for debugging purposes. */
  createdAt: DbSchema.text({}),
})

const WebSocketAttachmentSchema = Schema.parseJson(
  Schema.Struct({
    storeId: Schema.String,
  }),
)

/**
 * Needs to be bumped when the storage format changes (e.g. mutationLogTable schema changes)
 *
 * Changing this version number will lead to a "soft reset".
 */
export const PERSISTENCE_FORMAT_VERSION = 2

export type MakeDurableObjectClassOptions = {
  onPush?: (message: WSMessage.PushReq) => Effect.Effect<void> | Promise<void>
  onPull?: (message: WSMessage.PullReq) => Effect.Effect<void> | Promise<void>
}

export type MakeDurableObjectClass = (options?: MakeDurableObjectClassOptions) => {
  new (ctx: DurableObjectState, env: Env): DurableObject<Env>
}

export const makeDurableObject: MakeDurableObjectClass = (options) => {
  return class WebSocketServerBase extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
    }

    fetch = async (request: Request) =>
      Effect.gen(this, function* () {
        const storeId = getStoreId(request)
        const storage = makeStorage(this.ctx, this.env, storeId)

        const { 0: client, 1: server } = new WebSocketPair()

        // Since we're using websocket hibernation, we need to remember the storeId for subsequent `webSocketMessage` calls
        server.serializeAttachment(Schema.encodeSync(WebSocketAttachmentSchema)({ storeId }))

        // See https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server

        this.ctx.acceptWebSocket(server)

        this.ctx.setWebSocketAutoResponse(
          new WebSocketRequestResponsePair(
            encodeIncomingMessage(WSMessage.Ping.make({ requestId: 'ping' })),
            encodeOutgoingMessage(WSMessage.Pong.make({ requestId: 'ping' })),
          ),
        )

        const colSpec = makeColumnSpec(mutationLogTable.sqliteDef.ast)
        this.env.DB.exec(`CREATE TABLE IF NOT EXISTS ${storage.dbName} (${colSpec}) strict`)

        return new Response(null, {
          status: 101,
          webSocket: client,
        })
      }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)

    webSocketMessage = (ws: WebSocketClient, message: ArrayBuffer | string) =>
      Effect.gen(this, function* () {
        const decodedMessageRes = decodeIncomingMessage(message)

        if (decodedMessageRes._tag === 'Left') {
          console.error('Invalid message received', decodedMessageRes.left)
          return
        }

        const { storeId } = yield* Schema.decode(WebSocketAttachmentSchema)(ws.deserializeAttachment())
        const storage = makeStorage(this.ctx, this.env, storeId)

        const decodedMessage = decodedMessageRes.right
        const requestId = decodedMessage.requestId

        try {
          switch (decodedMessage._tag) {
            // TODO allow pulling concurrently to not block incoming push requests
            case 'WSMessage.PullReq': {
              if (options?.onPull) {
                yield* Effect.tryAll(() => options.onPull!(decodedMessage))
              }

              const cursor = decodedMessage.cursor
              const CHUNK_SIZE = 100

              // TODO use streaming
              const remainingEvents = yield* storage.getEvents(cursor)

              // Send at least one response, even if there are no events
              const batches =
                remainingEvents.length === 0
                  ? [[]]
                  : Array.from({ length: Math.ceil(remainingEvents.length / CHUNK_SIZE) }, (_, i) =>
                      remainingEvents.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
                    )

              for (const [index, batch] of batches.entries()) {
                const remaining = Math.max(0, remainingEvents.length - (index + 1) * CHUNK_SIZE)
                ws.send(encodeOutgoingMessage(WSMessage.PullRes.make({ batch, remaining })))
              }

              break
            }
            case 'WSMessage.PushReq': {
              if (options?.onPush) {
                yield* Effect.tryAll(() => options.onPush!(decodedMessage))
              }

              if (decodedMessage.batch.length === 0) {
                ws.send(encodeOutgoingMessage(WSMessage.PushAck.make({ requestId })))
                return
              }

              // TODO check whether we could use the Durable Object storage for this to speed up the lookup
              const expectedParentId = yield* storage.getHead

              // TODO handle clientId unique conflict

              // Validate the batch
              const firstEvent = decodedMessage.batch[0]!
              if (firstEvent.parentId !== expectedParentId) {
                const err = WSMessage.Error.make({
                  message: `Invalid parent id. Received ${firstEvent.parentId} but expected ${expectedParentId}`,
                  requestId,
                })

                yield* Effect.logError(err)

                ws.send(encodeOutgoingMessage(err))
                return
              }

              ws.send(encodeOutgoingMessage(WSMessage.PushAck.make({ requestId })))

              const createdAt = new Date().toISOString()

              // NOTE we're not waiting for this to complete yet to allow the broadcast to happen right away
              // while letting the async storage write happen in the background
              const storeFiber = yield* storage.appendEvents(decodedMessage.batch, createdAt).pipe(Effect.fork)

              const connectedClients = this.ctx.getWebSockets()

              // console.debug(`Broadcasting push batch to ${this.subscribedWebSockets.size} clients`)

              if (connectedClients.length > 0) {
                const pullRes = encodeOutgoingMessage(
                  // TODO refactor to batch api
                  WSMessage.PullRes.make({
                    batch: decodedMessage.batch.map((mutationEventEncoded) => ({
                      mutationEventEncoded,
                      metadata: Option.some({ createdAt }),
                    })),
                    remaining: 0,
                  }),
                )

                // NOTE we're also sending the pullRes to the pushing ws client as a confirmation
                for (const conn of connectedClients) {
                  conn.send(pullRes)
                }
              }

              // Wait for the storage write to complete before finishing this request
              yield* storeFiber

              break
            }
            case 'WSMessage.AdminResetRoomReq': {
              if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
                ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
                return
              }

              yield* storage.resetStore
              ws.send(encodeOutgoingMessage(WSMessage.AdminResetRoomRes.make({ requestId })))

              break
            }
            case 'WSMessage.AdminInfoReq': {
              if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
                ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
                return
              }

              ws.send(
                encodeOutgoingMessage(
                  WSMessage.AdminInfoRes.make({ requestId, info: { durableObjectId: this.ctx.id.toString() } }),
                ),
              )

              break
            }
            default: {
              console.error('unsupported message', decodedMessage)
              return shouldNeverHappen()
            }
          }
        } catch (error: any) {
          ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: error.message, requestId })))
        }
      }).pipe(
        Effect.withSpan('@livestore/sync-cf:durable-object:webSocketMessage'),
        Effect.tapCauseLogPretty,
        Logger.withMinimumLogLevel(LogLevel.Debug),
        Effect.provide(Logger.pretty),
        Effect.runPromise,
      )

    webSocketClose = async (ws: WebSocketClient, code: number, _reason: string, _wasClean: boolean) => {
      // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
      ws.close(code, 'Durable Object is closing WebSocket')
    }
  }
}

type SyncStorage = {
  dbName: string
  getHead: Effect.Effect<EventId.GlobalEventId, UnexpectedError>
  getEvents: (
    cursor: number | undefined,
  ) => Effect.Effect<
    ReadonlyArray<{ mutationEventEncoded: MutationEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>,
    UnexpectedError
  >
  appendEvents: (
    batch: ReadonlyArray<MutationEvent.AnyEncodedGlobal>,
    createdAt: string,
  ) => Effect.Effect<void, UnexpectedError>
  resetStore: Effect.Effect<void, UnexpectedError>
}

const makeStorage = (ctx: DurableObjectState, env: Env, storeId: string): SyncStorage => {
  const dbName = `mutation_log_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`

  const execDb = <T>(cb: (db: D1Database) => Promise<D1Result<T>>) =>
    Effect.tryPromise({
      try: () => cb(env.DB),
      catch: (error) => new UnexpectedError({ cause: error, payload: { dbName } }),
    }).pipe(Effect.map((_) => _.results))

  const getHead: Effect.Effect<EventId.GlobalEventId, UnexpectedError> = Effect.gen(function* () {
    const result = yield* execDb<{ id: EventId.GlobalEventId }>((db) =>
      db.prepare(`SELECT id FROM ${dbName} ORDER BY id DESC LIMIT 1`).all(),
    )

    return result[0]?.id ?? EventId.ROOT.global
  }).pipe(UnexpectedError.mapToUnexpectedError)

  const getEvents = (
    cursor: number | undefined,
  ): Effect.Effect<
    ReadonlyArray<{ mutationEventEncoded: MutationEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>,
    UnexpectedError
  > =>
    Effect.gen(function* () {
      const whereClause = cursor === undefined ? '' : `WHERE id > ${cursor}`
      const sql = `SELECT * FROM ${dbName} ${whereClause} ORDER BY id ASC`
      // TODO handle case where `cursor` was not found
      const rawEvents = yield* execDb((db) => db.prepare(sql).all())
      const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents).map(
        ({ createdAt, ...mutationEventEncoded }) => ({
          mutationEventEncoded,
          metadata: Option.some({ createdAt }),
        }),
      )
      return events
    })

  const appendEvents: SyncStorage['appendEvents'] = (batch, createdAt) =>
    Effect.gen(function* () {
      // If there are no events, do nothing.
      if (batch.length === 0) return

      // CF D1 limits:
      // Maximum bound parameters per query	100, Maximum arguments per SQL function	32
      // Thus we need to split the batch into chunks of max (100/5=)20 events each.
      const CHUNK_SIZE = 20

      for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
        const chunk = batch.slice(i, i + CHUNK_SIZE)

        // Create a list of placeholders ("(?, ?, ?, ?, ?), …") corresponding to each event.
        const valuesPlaceholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')
        const sql = `INSERT INTO ${dbName} (id, parentId, args, mutation, createdAt) VALUES ${valuesPlaceholders}`
        // Flatten the event properties into a parameters array.
        const params = chunk.flatMap((event) => [
          event.id,
          event.parentId,
          JSON.stringify(event.args),
          event.mutation,
          createdAt,
        ])

        yield* execDb((db) =>
          db
            .prepare(sql)
            .bind(...params)
            .run(),
        )
      }
    })

  const resetStore = Effect.gen(function* () {
    yield* Effect.promise(() => ctx.storage.deleteAll())
  }).pipe(UnexpectedError.mapToUnexpectedError)

  return { dbName, getHead, getEvents, appendEvents, resetStore }
}

const getStoreId = (request: Request) => {
  const url = new URL(request.url)
  const searchParams = url.searchParams
  const storeId = searchParams.get('storeId')
  if (storeId === null) {
    throw new Error('storeId search param is required')
  }
  return storeId
}

const toValidTableName = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_')
