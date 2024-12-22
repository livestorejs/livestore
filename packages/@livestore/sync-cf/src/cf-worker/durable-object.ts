import { makeColumnSpec, ROOT_ID } from '@livestore/common'
import { DbSchema, type MutationEvent, mutationEventSchemaAny } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { DurableObject } from 'cloudflare:workers'

import { WSMessage } from '../common/index.js'

export interface Env {
  WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>
  DB: D1Database
  ADMIN_SECRET: string
}

type WebSocketClient = WebSocket

const encodeOutgoingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.BackendToClientMessage))
const encodeIncomingMessage = Schema.encodeSync(Schema.parseJson(WSMessage.ClientToBackendMessage))
const decodeIncomingMessage = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.ClientToBackendMessage))

export const mutationLogTable = DbSchema.table('__unused', {
  idGlobal: DbSchema.integer({ primaryKey: true }),
  parentIdGlobal: DbSchema.integer({}),
  mutation: DbSchema.text({}),
  args: DbSchema.text({ schema: Schema.parseJson(Schema.Any) }),
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

  webSocketMessage = async (ws: WebSocketClient, message: ArrayBuffer | string) => {
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
          const remainingEvents = [...(await this.storage.getEvents(cursor))]

          // NOTE we want to make sure the WS server responds at least once with `InitRes` even if `events` is empty
          while (true) {
            const events = remainingEvents.splice(0, CHUNK_SIZE)
            const encodedEvents = Schema.encodeSync(Schema.Array(mutationEventSchemaAny))(events)

            ws.send(
              encodeOutgoingMessage(
                WSMessage.PullRes.make({
                  events: encodedEvents,
                  remaining: remainingEvents.length,
                  requestId,
                }),
              ),
            )

            if (remainingEvents.length === 0) {
              break
            }
          }

          break
        }
        case 'WSMessage.PushReq': {
          // TODO check whether we could use the Durable Object storage for this to speed up the lookup
          const latestEvent = await this.storage.getLatestEvent()
          const expectedParentId = latestEvent?.id ?? ROOT_ID

          for (const mutationEventEncoded of decodedMessage.batch) {
            if (mutationEventEncoded.parentId.global !== expectedParentId.global) {
              ws.send(
                encodeOutgoingMessage(
                  WSMessage.Error.make({
                    message: `Invalid parent id. Received ${mutationEventEncoded.parentId.global} but expected ${expectedParentId.global}`,
                    requestId,
                  }),
                ),
              )
              return
            }

            // TODO handle clientId unique conflict

            // NOTE we're currently not blocking on this to allow broadcasting right away
            const storePromise = decodedMessage.persisted
              ? this.storage.appendEvent(mutationEventEncoded)
              : Promise.resolve()

            ws.send(
              encodeOutgoingMessage(WSMessage.PushAck.make({ mutationId: mutationEventEncoded.id.global, requestId })),
            )

            // console.debug(`Broadcasting mutation event to ${this.subscribedWebSockets.size} clients`)

            const connectedClients = this.ctx.getWebSockets()

            if (connectedClients.length > 0) {
              const broadcastMessage = encodeOutgoingMessage(
                // TODO refactor to batch api
                WSMessage.PushBroadcast.make({ mutationEventEncoded, persisted: decodedMessage.persisted }),
              )

              for (const conn of connectedClients) {
                console.log('Broadcasting to client', conn === ws ? 'self' : 'other')
                // if (conn !== ws) {
                conn.send(broadcastMessage)
                // }
              }
            }

            await storePromise
          }

          break
        }
        case 'WSMessage.AdminResetRoomReq': {
          if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
            ws.send(encodeOutgoingMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
            return
          }

          await this.storage.resetRoom()
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
  }

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
      id: { global: e.idGlobal, local: 0 },
      parentId: { global: e.parentIdGlobal, local: 0 },
    }))
    return events[0]
  }

  const getEvents = async (cursor: number | undefined): Promise<ReadonlyArray<MutationEvent.Any>> => {
    const whereClause = cursor ? `WHERE idGlobal > ${cursor}` : ''
    // TODO handle case where `cursor` was not found
    const rawEvents = await env.DB.prepare(`SELECT * FROM ${dbName} ${whereClause} ORDER BY idGlobal ASC`).all()
    if (rawEvents.error) {
      throw new Error(rawEvents.error)
    }
    const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents.results).map((e) => ({
      ...e,
      id: { global: e.idGlobal, local: 0 },
      parentId: { global: e.parentIdGlobal, local: 0 },
    }))
    return events
  }

  const appendEvent = async (event: MutationEvent.Any) => {
    const sql = `INSERT INTO ${dbName} (idGlobal, parentIdGlobal, args, mutation) VALUES (?, ?, ?, ?)`
    await env.DB.prepare(sql)
      .bind(event.id.global, event.parentId.global, JSON.stringify(event.args), event.mutation)
      .run()
  }

  const resetRoom = async () => {
    await ctx.storage.deleteAll()
  }

  return { getLatestEvent, getEvents, appendEvent, resetRoom }
}
