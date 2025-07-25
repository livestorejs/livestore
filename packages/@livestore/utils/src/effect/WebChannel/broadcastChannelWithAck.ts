import { Deferred, Exit, Predicate, Queue, Schema, Scope, Stream } from 'effect'

import * as Effect from '../Effect.ts'
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

const Message = Schema.Union(ConnectMessage, ConnectAckMessage, DisconnectMessage, PayloadMessage)

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
      const messageQueue = yield* Queue.unbounded<MsgSend>()
      const connectionId = crypto.randomUUID()
      const schema = mapSchema(inputSchema)

      const peerIdRef = { current: undefined as undefined | string }
      const connectedLatch = yield* Effect.makeLatch(false)
      const supportsTransferables = false

      const postMessage = (msg: typeof Message.Type) => channel.postMessage(Schema.encodeSync(Message)(msg))

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          yield* connectedLatch.await

          const payload = yield* Schema.encode(schema.send)(message)
          postMessage(PayloadMessage.make({ from: connectionId, to: peerIdRef.current!, payload }))
        })

      const listen = Stream.fromEventListener<MessageEvent>(channel, 'message').pipe(
        Stream.map(({ data }) => data),
        Stream.map(Schema.decodeOption(Message)),
        Stream.filterMap((_) => _),
        Stream.mapEffect((data) =>
          Effect.gen(function* () {
            switch (data._tag) {
              // Case: other side sends connect message (because otherside wasn't yet online when this side send their connect message)
              case 'ConnectMessage': {
                peerIdRef.current = data.from
                postMessage(ConnectAckMessage.make({ from: connectionId, to: data.from }))
                yield* connectedLatch.open
                break
              }
              // Case: other side sends connect-ack message (because otherside was already online when this side connected)
              case 'ConnectAckMessage': {
                if (data.to === connectionId) {
                  peerIdRef.current = data.from
                  yield* connectedLatch.open
                }
                break
              }
              case 'DisconnectMessage': {
                if (data.from === peerIdRef.current) {
                  peerIdRef.current = undefined
                  yield* connectedLatch.close
                  yield* establishConnection
                }
                break
              }
              case 'PayloadMessage': {
                if (data.to === connectionId) {
                  return Schema.decodeEither(schema.listen)(data.payload)
                }
                break
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
          yield* Queue.shutdown(messageQueue)
        }),
      )

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))

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
