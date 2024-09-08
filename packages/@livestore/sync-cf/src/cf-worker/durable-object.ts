import { makeColumnSpec } from '@livestore/common'
import { DbSchema, type MutationEvent } from '@livestore/common/schema'
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

const encodeMessage = Schema.encodeSync(Schema.parseJson(WSMessage.Message))
const decodeMessage = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.Message))

export const mutationLogTable = DbSchema.table('__unused', {
  // TODO add parent ids (see https://vlcn.io/blog/crdt-substrate)
  id: DbSchema.text({ primaryKey: true }),
  mutation: DbSchema.text({ nullable: false }),
  args: DbSchema.text({ nullable: false, schema: Schema.parseJson(Schema.Any) }),
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
          encodeMessage(WSMessage.Ping.make({ requestId: 'ping' })),
          encodeMessage(WSMessage.Pong.make({ requestId: 'ping' })),
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
    const decodedMessageRes = decodeMessage(message)

    if (decodedMessageRes._tag === 'Left') {
      console.error('Invalid message received', decodedMessageRes.left)
      return
    }

    const decodedMessage = decodedMessageRes.right
    const requestId = decodedMessage.requestId

    switch (decodedMessage._tag) {
      case 'WSMessage.PullReq': {
        const cursor = decodedMessage.cursor
        const CHUNK_SIZE = 100

        // TODO use streaming
        const remainingEvents = [...(await this.storage.getEvents(cursor))]

        // NOTE we want to make sure the WS server responds at least once with `InitRes` even if `events` is empty
        while (true) {
          const events = remainingEvents.splice(0, CHUNK_SIZE)
          const hasMore = remainingEvents.length > 0

          ws.send(encodeMessage(WSMessage.PullRes.make({ events, hasMore, requestId })))

          if (hasMore === false) {
            break
          }
        }

        break
      }
      case 'WSMessage.PushReq': {
        // NOTE we're currently not blocking on this to allow broadcasting right away
        // however we should do some mutation validation first (e.g. checking parent event id)
        const storePromise = decodedMessage.persisted
          ? this.storage.appendEvent(decodedMessage.mutationEventEncoded)
          : Promise.resolve()

        ws.send(
          encodeMessage(WSMessage.PushAck.make({ mutationId: decodedMessage.mutationEventEncoded.id, requestId })),
        )

        // console.debug(`Broadcasting mutation event to ${this.subscribedWebSockets.size} clients`)

        const connectedClients = this.ctx.getWebSockets()

        if (connectedClients.length > 0) {
          const broadcastMessage = encodeMessage(
            WSMessage.PushBroadcast.make({
              mutationEventEncoded: decodedMessage.mutationEventEncoded,
              requestId,
              persisted: decodedMessage.persisted,
            }),
          )

          for (const conn of connectedClients) {
            console.log('Broadcasting to client', conn === ws ? 'self' : 'other')
            if (conn !== ws) {
              conn.send(broadcastMessage)
            }
          }
        }

        await storePromise

        break
      }
      case 'WSMessage.AdminResetRoomReq': {
        if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
          ws.send(encodeMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
          return
        }

        await this.storage.resetRoom()
        ws.send(encodeMessage(WSMessage.AdminResetRoomRes.make({ requestId })))

        break
      }
      case 'WSMessage.AdminInfoReq': {
        if (decodedMessage.adminSecret !== this.env.ADMIN_SECRET) {
          ws.send(encodeMessage(WSMessage.Error.make({ message: 'Invalid admin secret', requestId })))
          return
        }

        ws.send(
          encodeMessage(WSMessage.AdminInfoRes.make({ requestId, info: { durableObjectId: this.ctx.id.toString() } })),
        )

        break
      }
      default: {
        console.error('unsupported message', decodedMessage)
        return shouldNeverHappen()
      }
    }
  }

  webSocketClose = async (ws: WebSocketClient, code: number, _reason: string, _wasClean: boolean) => {
    // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
    ws.close(code, 'Durable Object is closing WebSocket')
  }
}

const makeStorage = (ctx: DurableObjectState, env: Env, dbName: string) => {
  const getEvents = async (cursor: string | undefined): Promise<ReadonlyArray<MutationEvent.Any>> => {
    const whereClause = cursor ? `WHERE id > '${cursor}'` : ''
    // TODO handle case where `cursor` was not found
    const rawEvents = await env.DB.prepare(`SELECT * FROM ${dbName} ${whereClause} ORDER BY id ASC`).all()
    if (rawEvents.error) {
      throw new Error(rawEvents.error)
    }
    const events = Schema.decodeUnknownSync(Schema.Array(mutationLogTable.schema))(rawEvents.results)
    return events
  }

  const appendEvent = async (event: MutationEvent.Any) => {
    const sql = `INSERT INTO ${dbName} (id, args, mutation) VALUES (?, ?, ?)`
    await env.DB.prepare(sql).bind(event.id, JSON.stringify(event.args), event.mutation).run()
  }

  const resetRoom = async () => {
    await ctx.storage.deleteAll()
  }

  return { getEvents, appendEvent, resetRoom }
}
