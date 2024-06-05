import { WSMessage } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { DurableObject } from 'cloudflare:workers'

export interface Env {
  WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>
}

type WebSocketClient = WebSocket

const encodeMessage = Schema.encodeSync(Schema.parseJson(WSMessage.Message))
const decodeMessage = Schema.decodeUnknownEither(Schema.parseJson(WSMessage.Message))

// Durable Object
export class WebSocketServer extends DurableObject {
  // subscribedWebSockets: Set<WebSocketClient>
  // mutationEventsEncoded: MutationEvent.Any[] = []
  storage = makeStorage(this.ctx)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // ctx.storage.
    // this.subscribedWebSockets = new Set()
    console.log('WebSocketServer DO created')
  }

  fetch = async (_request: Request) =>
    Effect.gen(this, function* () {
      const { 0: client, 1: server } = new WebSocketPair()

      // See https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server

      this.ctx.acceptWebSocket(server)

      // this.subscribedWebSockets.set(server, client)

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }).pipe(Effect.tapCauseLogPretty, Effect.runPromise)

  webSocketMessage = async (ws: WebSocketClient, message: ArrayBuffer | string) => {
    // Upon receiving a message from the client, reply with the same message,
    // but will prefix the message with "[Durable Object]: " and return the
    // total number of connections.
    // ws.send(`[Durable Object] message: ${message}, connections: ${this.ctx.getWebSockets().length}`)

    const decodedMessageRes = decodeMessage(message)

    if (decodedMessageRes._tag === 'Left') {
      console.error('Invalid message received', decodedMessageRes.left)
      return
    }

    const decodedMessage = decodedMessageRes.right

    if (decodedMessage._tag === 'WSMessage.PullReq') {
      const cursor = decodedMessage.cursor
      const CHUNK_SIZE = 100

      const allEvents = await this.storage.getEvents()
      const eventStartIndex = cursor === undefined ? 0 : allEvents.findIndex((event) => event.id === cursor) + 1

      const remainingEvents = allEvents.slice(eventStartIndex)

      // NOTE we want to make sure the WS server responds at least once with `InitRes` even if `events` is empty
      while (true) {
        const events = remainingEvents.splice(0, CHUNK_SIZE)
        const hasMore = remainingEvents.length > 0

        ws.send(encodeMessage(WSMessage.PullRes.make({ _tag: 'WSMessage.PullRes', events, hasMore })))

        if (hasMore === false) {
          break
        }
      }

      // this.subscribedWebSockets.add(ws)
    } else if (decodedMessage._tag === 'WSMessage.PushReq') {
      // if (this.subscribedWebSockets.has(ws) === false) {
      //   console.error('Client is not subscribed')
      //   ws.send(encodeMessage(WSMessage.Error.make({ _tag: 'WSMessage.Error', message: 'Client is not subscribed' })))
      //   return
      // }

      const allEvents = await this.storage.getEvents()
      if (allEvents.some((event) => event.id === decodedMessage.mutationEventEncoded.id)) {
        console.error('Event already broadcasted')
        ws.send(encodeMessage(WSMessage.Error.make({ _tag: 'WSMessage.Error', message: 'Event already broadcasted' })))
        return
      }

      // NOTE we're doing this out of band to already do the broadcast to the client
      void this.storage.appendEvent(decodedMessage.mutationEventEncoded)

      ws.send(
        encodeMessage(
          WSMessage.PushAck.make({
            _tag: 'WSMessage.PushAck',
            mutationId: decodedMessage.mutationEventEncoded.id,
          }),
        ),
      )

      // console.debug(`Broadcasting mutation event to ${this.subscribedWebSockets.size} clients`)

      // this.ctx.getWebSockets()[0]!

      const connectedClients = this.ctx.getWebSockets()

      if (connectedClients.length > 0) {
        const broadcastMessage = encodeMessage(
          WSMessage.PushBroadcast.make({
            _tag: 'WSMessage.PushBroadcast',
            mutationEventEncoded: decodedMessage.mutationEventEncoded,
          }),
        )

        for (const conn of connectedClients) {
          console.log('Broadcasting to client', conn === ws ? 'self' : 'other')
          if (conn !== ws) {
            conn.send(broadcastMessage)
          }
        }
      }
    } else {
      console.error('unsupported message', decodedMessage)
      return shouldNeverHappen()
    }
  }

  webSocketClose = async (ws: WebSocketClient, code: number, _reason: string, _wasClean: boolean) => {
    // this.subscribedWebSockets.delete(ws)

    // console.log('remaining clients', this.subscribedWebSockets.size)

    // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
    ws.close(code, 'Durable Object is closing WebSocket')
  }
}

const makeStorage = (ctx: DurableObjectState) => {
  const getEvents = async (): Promise<MutationEvent.Any[]> => {
    const events = await ctx.storage.get('events')
    return events ?? ([] as any)
  }

  const appendEvent = async (event: MutationEvent.Any) => {
    const events = await getEvents()
    events.push(event)
    await ctx.storage.put('events', events)
  }

  return { getEvents, appendEvent }
}
