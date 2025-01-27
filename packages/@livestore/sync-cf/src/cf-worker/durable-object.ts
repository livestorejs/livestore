import { makeColumnSpec } from '@livestore/common'
import { DbSchema, EventId, type MutationEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Logger, LogLevel, Option, Schema } from '@livestore/utils/effect'
import { DurableObject } from 'cloudflare:workers'

import { WSMessage } from '../common/index.js'
import type { SyncMetadata } from '../common/ws-message-types.js'

export interface Env {
  WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>
  DB: D1Database
  ADMIN_SECRET: string
}

type WebSocketClient = WebSocket

const encodeOutgoingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.BackendToClientMessage))
const encodeIncomingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.ClientToBackendMessage))
const decodeIncomingMessage = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.ClientToBackendMessage))

// NOTE actual table name is determined at runtime by `WebSocketServer.dbName`
export const mutationLogTable = DbSchema.table('__unused', {
  idGlobal: DbSchema.integer({ primaryKey: true }),
  parentIdGlobal: DbSchema.integer({}),
  mutation: DbSchema.text({}),
  args: DbSchema.text({ schema: Schema.parseJson(Schema.Any) }),
  /** ISO date format */
  createdAt: DbSchema.text({}),
})

// Durable Object
export class WebSocketServer extends DurableObject<Env> {
  dbName = `mutation_log_${this.ctx.id.toString()}`
  storage = makeStorage(this.ctx, this.env, this.dbName)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  fetch = async (_request: Request) =>
    Effect.gen(this, function* () {
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
      this.env.DB.exec(`CREATE TABLE IF NOT EXISTS ${this.dbName} (${colSpec}) strict`)

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

      try {
        switch (decodedMessage._tag) {
          case 'WSMessage.PullReq': {
            const cursor = decodedMessage.cursor
            const CHUNK_SIZE = 100

            // TODO use streaming
            const remainingEvents = [...(yield* Effect.promise(() => this.storage.getEvents(cursor)))]

            // NOTE we want to make sure the WS server responds at least once with `InitRes` even if `events` is empty
            while (true) {
              const events = remainingEvents.splice(0, CHUNK_SIZE)

              ws.send(
                encodeOutgoingMessage(WSMessage.PullRes.make({ events, remaining: remainingEvents.length, requestId })),
              )

              if (remainingEvents.length === 0) {
                break
              }
            }

            break
          }
          case 'WSMessage.PushReq': {
            // TODO check whether we could use the Durable Object storage for this to speed up the lookup
            const latestEvent = yield* Effect.promise(() => this.storage.getLatestEvent())
            const expectedParentId = latestEvent?.id ?? EventId.ROOT

            let i = 0
            for (const mutationEventEncoded of decodedMessage.batch) {
              if (mutationEventEncoded.parentId.global !== expectedParentId.global + i) {
                const err = WSMessage.Error.make({
                  message: `Invalid parent id. Received ${mutationEventEncoded.parentId.global} but expected ${expectedParentId.global}`,
                  requestId,
                })

                yield* Effect.fail(err).pipe(Effect.ignoreLogged)

                ws.send(encodeOutgoingMessage(err))
                return
              }

              // TODO handle clientId unique conflict

              const createdAt = new Date().toISOString()

              // NOTE we're currently not blocking on this to allow broadcasting right away
              const storePromise = this.storage.appendEvent(mutationEventEncoded, createdAt)

              ws.send(
                encodeOutgoingMessage(
                  WSMessage.PushAck.make({ mutationId: mutationEventEncoded.id.global, requestId }),
                ),
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

            yield* Effect.promise(() => this.storage.resetRoom())
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

const makeStorage = (ctx: DurableObjectState, env: Env, dbName: string) => {
  const getLatestEvent = async (): Promise<MutationEvent.Any | undefined> => {
    const rawEvents = await env.DB.prepare(`SELECT * FROM ${dbName} ORDER BY idGlobal DESC LIMIT 1`).all()
    if (rawEvents.error) {
      throw new Error(rawEvents.error)
    }
    const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents.results).map((e) => ({
      ...e,
      // TODO remove local ids
      id: { global: e.idGlobal, local: 0 },
      parentId: { global: e.parentIdGlobal, local: 0 },
    }))
    return events[0]
  }

  const getEvents = async (
    cursor: number | undefined,
  ): Promise<
    ReadonlyArray<{ mutationEventEncoded: MutationEvent.AnyEncoded; metadata: Option.Option<SyncMetadata> }>
  > => {
    const whereClause = cursor === undefined ? '' : `WHERE idGlobal > ${cursor}`
    const sql = `SELECT * FROM ${dbName} ${whereClause} ORDER BY idGlobal ASC`
    // TODO handle case where `cursor` was not found
    const rawEvents = await env.DB.prepare(sql).all()
    if (rawEvents.error) {
      throw new Error(rawEvents.error)
    }
    const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents.results).map(
      ({ createdAt, ...e }) => ({
        mutationEventEncoded: {
          ...e,
          // TODO remove local ids
          id: { global: e.idGlobal, local: 0 },
          parentId: { global: e.parentIdGlobal, local: 0 },
        },
        metadata: Option.some({ createdAt }),
      }),
    )
    return events
  }

  const appendEvent = async (event: MutationEvent.Any, createdAt: string) => {
    const sql = `INSERT INTO ${dbName} (idGlobal, parentIdGlobal, args, mutation, createdAt) VALUES (?, ?, ?, ?, ?)`
    await env.DB.prepare(sql)
      .bind(event.id.global, event.parentId.global, JSON.stringify(event.args), event.mutation, createdAt)
      .run()
  }

  const resetRoom = async () => {
    await ctx.storage.deleteAll()
  }

  return { getLatestEvent, getEvents, appendEvent, resetRoom }
}
