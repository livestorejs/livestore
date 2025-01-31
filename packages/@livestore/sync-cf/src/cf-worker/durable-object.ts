import { makeColumnSpec } from '@livestore/common'
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

// NOTE actual table name is determined at runtime by `WebSocketServer.dbName`
export const mutationLogTable = DbSchema.table('__unused', {
  id: DbSchema.integer({ primaryKey: true, schema: EventId.GlobalEventId }),
  parentId: DbSchema.integer({ schema: EventId.GlobalEventId }),
  mutation: DbSchema.text({}),
  args: DbSchema.text({ schema: Schema.parseJson(Schema.Any) }),
  /** ISO date format. Currently only used for debugging purposes. */
  createdAt: DbSchema.text({}),
})

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
    storage: SyncStorage | undefined = undefined

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
    }

    fetch = async (request: Request) =>
      Effect.gen(this, function* () {
        if (this.storage === undefined) {
          const storeId = getStoreId(request)
          const dbName = `mutation_log_${PERSISTENCE_FORMAT_VERSION}_${toValidTableName(storeId)}`
          this.storage = makeStorage(this.ctx, this.env, dbName)
        }

        const { 0: client, 1: server } = new WebSocketPair()

        // See https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server

        this.ctx.acceptWebSocket(server)

        this.ctx.setWebSocketAutoResponse(
          new WebSocketRequestResponsePair(
            encodeIncomingMessage(WSMessage.Ping.make({ requestId: 'ping' })),
            encodeOutgoingMessage(WSMessage.Pong.make({ requestId: 'ping' })),
          ),
        )

        const colSpec = makeColumnSpec(mutationLogTable.sqliteDef.ast)
        this.env.DB.exec(`CREATE TABLE IF NOT EXISTS ${this.storage.dbName} (${colSpec}) strict`)

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

        const decodedMessage = decodedMessageRes.right
        const requestId = decodedMessage.requestId

        const storage = this.storage

        if (storage === undefined) {
          throw new Error('storage not initialized')
        }

        try {
          switch (decodedMessage._tag) {
            case 'WSMessage.PullReq': {
              if (options?.onPull) {
                yield* Effect.tryAll(() => options.onPull!(decodedMessage))
              }

              const cursor = decodedMessage.cursor
              const CHUNK_SIZE = 100

              // TODO use streaming
              const remainingEvents = [...(yield* Effect.promise(() => storage.getEvents(cursor)))]

              // NOTE we want to make sure the WS server responds at least once with `InitRes` even if `events` is empty
              while (true) {
                const events = remainingEvents.splice(0, CHUNK_SIZE)

                ws.send(
                  encodeOutgoingMessage(
                    WSMessage.PullRes.make({ events, remaining: remainingEvents.length, requestId }),
                  ),
                )

                if (remainingEvents.length === 0) {
                  break
                }
              }

              break
            }
            case 'WSMessage.PushReq': {
              if (options?.onPush) {
                yield* Effect.tryAll(() => options.onPush!(decodedMessage))
              }

              // TODO check whether we could use the Durable Object storage for this to speed up the lookup
              const latestEvent = yield* Effect.promise(() => storage.getLatestEvent())
              const expectedParentId = latestEvent?.id ?? EventId.ROOT.global

              let i = 0
              for (const mutationEventEncoded of decodedMessage.batch) {
                if (mutationEventEncoded.parentId !== expectedParentId + i) {
                  const err = WSMessage.Error.make({
                    message: `Invalid parent id. Received ${mutationEventEncoded.parentId} but expected ${expectedParentId}`,
                    requestId,
                  })

                  yield* Effect.fail(err).pipe(Effect.ignoreLogged)

                  ws.send(encodeOutgoingMessage(err))
                  return
                }

                // TODO handle clientId unique conflict

                const createdAt = new Date().toISOString()

                // NOTE we're currently not blocking on this to allow broadcasting right away
                const storePromise = storage.appendEvent(mutationEventEncoded, createdAt)

                ws.send(
                  encodeOutgoingMessage(WSMessage.PushAck.make({ mutationId: mutationEventEncoded.id, requestId })),
                )

                // console.debug(`Broadcasting mutation event to ${this.subscribedWebSockets.size} clients`)

                const connectedClients = this.ctx.getWebSockets()

                if (connectedClients.length > 0) {
                  const broadcastMessage = encodeOutgoingMessage(
                    // TODO refactor to batch api
                    WSMessage.PushBroadcast.make({
                      mutationEventEncoded,
                      metadata: Option.some({ createdAt }),
                    }),
                  )

                  for (const conn of connectedClients) {
                    console.log('Broadcasting to client', conn === ws ? 'self' : 'other')
                    // if (conn !== ws) {
                    conn.send(broadcastMessage)
                    // }
                  }
                }

                yield* Effect.promise(() => storePromise)

                i++
              }

              break
            }
            case 'WSMessage.AdminResetRoomReq': {
              if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
                ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
                return
              }

              yield* Effect.promise(() => storage.resetRoom())
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
  getLatestEvent: () => Promise<MutationEvent.AnyEncodedGlobal | undefined>
  getEvents: (
    cursor: number | undefined,
  ) => Promise<
    ReadonlyArray<{ mutationEventEncoded: MutationEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>
  >
  appendEvent: (event: MutationEvent.AnyEncodedGlobal, createdAt: string) => Promise<void>
  resetRoom: () => Promise<void>
}

const makeStorage = (ctx: DurableObjectState, env: Env, dbName: string): SyncStorage => {
  const getLatestEvent = async (): Promise<MutationEvent.AnyEncodedGlobal | undefined> => {
    const rawEvents = await env.DB.prepare(`SELECT * FROM ${dbName} ORDER BY id DESC LIMIT 1`).all()
    if (rawEvents.error) {
      throw new Error(rawEvents.error)
    }
    const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents.results)

    return events[0]
  }

  const getEvents = async (
    cursor: number | undefined,
  ): Promise<
    ReadonlyArray<{ mutationEventEncoded: MutationEvent.AnyEncodedGlobal; metadata: Option.Option<SyncMetadata> }>
  > => {
    const whereClause = cursor === undefined ? '' : `WHERE id > ${cursor}`
    const sql = `SELECT * FROM ${dbName} ${whereClause} ORDER BY id ASC`
    // TODO handle case where `cursor` was not found
    const rawEvents = await env.DB.prepare(sql).all()
    if (rawEvents.error) {
      throw new Error(rawEvents.error)
    }
    const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents.results).map(
      ({ createdAt, ...mutationEventEncoded }) => ({
        mutationEventEncoded,
        metadata: Option.some({ createdAt }),
      }),
    )
    return events
  }

  const appendEvent = async (event: MutationEvent.AnyEncodedGlobal, createdAt: string) => {
    const sql = `INSERT INTO ${dbName} (id, parentId, args, mutation, createdAt) VALUES (?, ?, ?, ?, ?)`
    await env.DB.prepare(sql)
      .bind(event.id, event.parentId, JSON.stringify(event.args), event.mutation, createdAt)
      .run()
  }

  const resetRoom = async () => {
    await ctx.storage.deleteAll()
  }

  return { dbName, getLatestEvent, getEvents, appendEvent, resetRoom }
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
