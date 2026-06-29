import { Deferred, Exit, Filter, Latch, Predicate, Queue, Scope, Stream } from 'effect'

import * as Effect from '../Effect.ts'
import * as Schema from '../Schema/index.ts'
import type { InputSchema, WebChannel } from './common.ts'
import { listenToDebugPing, mapSchema, WebChannelSymbol } from './common.ts'

const ConnectMessage = Schema.TaggedStruct('ConnectMessage', {
  from: Schema.String,
})

const ConnectAckMessage = Schema.TaggedStruct('ConnectAckMessage', {
  from: Schema.String,
  to: Schema.String,
})

const DisconnectMessage = Schema.TaggedStruct('DisconnectMessage', {
  from: Schema.String,
})

const PayloadMessage = Schema.TaggedStruct('PayloadMessage', {
  from: Schema.String,
  to: Schema.String,
  payload: Schema.Any,
})

const Message = Schema.Union([ConnectMessage, ConnectAckMessage, DisconnectMessage, PayloadMessage])

/**
 * Same as `broadcastChannel`, but with a queue in between to guarantee message delivery and meant
 * for 1:1 connections.
 */
export const broadcastChannelWithAck = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  channelName,
  schema: inputSchema,
}: {
  channelName: string
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const channel = new BroadcastChannel(channelName)
      // BroadcastChannel messages are dropped unless a listener is already registered. Effect v4
      // makes stream startup ordering explicit, so buffer events from channel construction time.
      const messageQueue = yield* Effect.acquireRelease(Queue.unbounded<MessageDataEvent>(), Queue.shutdown)
      const connectionId = crypto.randomUUID()
      const schema = mapSchema(inputSchema)

      const peerIdRef = { current: undefined as undefined | string }
      const connectedLatch = yield* Latch.make(false)
      const supportsTransferables = false

      const postMessage = (msg: typeof Message.Type) => channel.postMessage(Schema.encodeSync(Message)(msg))

      const handler = (event: MessageDataEvent) => {
        Queue.offerUnsafe(messageQueue, event)
      }
      channel.addEventListener('message', handler)
      yield* Effect.addFinalizer(() => Effect.sync(() => channel.removeEventListener('message', handler)))

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          yield* connectedLatch.await

          const payload = yield* Schema.encodeEffect(schema.send)(message)
          postMessage(PayloadMessage.make({ from: connectionId, to: peerIdRef.current!, payload }))
        })

      const listen = Stream.fromQueue(messageQueue).pipe(
        Stream.map(({ data }) => data),
        Stream.filterMap(Filter.fromPredicateOption(Schema.decodeUnknownOption(Message))),
        Stream.mapEffect((data) =>
          Effect.gen(function* () {
            switch (data._tag) {
              // Case: other side sends connect message (because otherside wasn't yet online when this side send their connect message)
              case 'ConnectMessage': {
                peerIdRef.current = data.from
                postMessage(ConnectAckMessage.make({ from: connectionId, to: data.from }))
                yield* connectedLatch.open
                return undefined
              }
              // Case: other side sends connect-ack message (because otherside was already online when this side connected)
              case 'ConnectAckMessage': {
                if (data.to === connectionId) {
                  peerIdRef.current = data.from
                  yield* connectedLatch.open
                }
                return undefined
              }
              case 'DisconnectMessage': {
                if (data.from === peerIdRef.current) {
                  peerIdRef.current = undefined
                  yield* connectedLatch.close
                  yield* establishConnection
                }
                return undefined
              }
              case 'PayloadMessage': {
                if (data.to === connectionId) {
                  return Schema.decodeResult(schema.listen)(data.payload)
                }
                return undefined
              }
            }
          }),
        ),
        Stream.filter(Predicate.isNotUndefined),
        listenToDebugPing(channelName),
      )

      const establishConnection = Effect.gen(function* () {
        postMessage(ConnectMessage.make({ from: connectionId }))
      })

      yield* establishConnection

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          postMessage(DisconnectMessage.make({ from: connectionId }))
          channel.close()
        }),
      )

      const closedDeferred = yield* Effect.acquireRelease(Deferred.make<void>(), Deferred.done(Exit.void))

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.void),
        schema,
        supportsTransferables,
      }
    }).pipe(Effect.withSpan(`WebChannel:broadcastChannelWithAck(${channelName})`)),
  )

/** DOM and Node worker_threads expose incompatible MessageEvent globals; the channel only needs payload data. */
type MessageDataEvent = Event & { readonly data: any }
