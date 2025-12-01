import { Deferred, Exit, Scope } from 'effect'

import * as Effect from '../effect/Effect.ts'
import * as Schema from '../effect/Schema/index.ts'
import * as Stream from '../effect/Stream.ts'
import {
  type InputSchema,
  listenToDebugPing,
  mapSchema,
  type WebChannel,
  WebChannelSymbol,
} from '../effect/WebChannel/common.ts'

/** Browser BroadcastChannel-backed WebChannel */
export const broadcastChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  channelName,
  schema: inputSchema,
}: {
  channelName: string
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const channel = new BroadcastChannel(channelName)

      yield* Effect.addFinalizer(() => Effect.try(() => channel.close()).pipe(Effect.ignoreLogged))

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          const messageEncoded = yield* Schema.encode(schema.send)(message)
          channel.postMessage(messageEncoded)
        })

      // TODO also listen to `messageerror` in parallel
      const listen = Stream.fromEventListener<MessageEvent>(channel, 'message').pipe(
        Stream.map((_) => Schema.decodeEither(schema.listen)(_.data)),
        listenToDebugPing(channelName),
      )

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = false

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
      }
    }).pipe(Effect.withSpan(`WebChannel:broadcastChannel(${channelName})`)),
  )

/**
 * Window.postMessage-based WebChannel
 */
export const windowChannel = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>({
  listenWindow,
  sendWindow,
  targetOrigin = '*',
  ids,
  schema: inputSchema,
}: {
  listenWindow: Window
  sendWindow: Window
  targetOrigin?: string
  ids: { own: string; other: string }
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>
}): Effect.Effect<WebChannel<MsgListen, MsgSend>, never, Scope.Scope> =>
  Effect.scopeWithCloseable((scope) =>
    Effect.gen(function* () {
      const schema = mapSchema(inputSchema)

      const debugInfo = {
        sendTotal: 0,
        listenTotal: 0,
        targetOrigin,
        ids,
      }

      const WindowMessageListen = Schema.Struct({
        message: schema.listen,
        from: Schema.Literal(ids.other),
        to: Schema.Literal(ids.own),
      }).annotations({ title: 'webmesh.WindowMessageListen' })

      const WindowMessageSend = Schema.Struct({
        message: schema.send,
        from: Schema.Literal(ids.own),
        to: Schema.Literal(ids.other),
      }).annotations({ title: 'webmesh.WindowMessageSend' })

      const send = (message: MsgSend) =>
        Effect.gen(function* () {
          debugInfo.sendTotal++

          const [messageEncoded, transferables] = yield* Schema.encodeWithTransferables(WindowMessageSend)({
            message,
            from: ids.own,
            to: ids.other,
          })
          sendWindow.postMessage(messageEncoded, targetOrigin, transferables)
        })

      const listen = Stream.fromEventListener<MessageEvent>(listenWindow, 'message').pipe(
        Stream.filter((_) => Schema.is(Schema.encodedSchema(WindowMessageListen))(_.data)),
        Stream.map((_) => {
          debugInfo.listenTotal++
          return Schema.decodeEither(schema.listen)(_.data.message)
        }),
        listenToDebugPing('window'),
      )

      const closedDeferred = yield* Deferred.make<void>().pipe(Effect.acquireRelease(Deferred.done(Exit.void)))
      const supportsTransferables = true

      return {
        [WebChannelSymbol]: WebChannelSymbol,
        send,
        listen,
        closedDeferred,
        shutdown: Scope.close(scope, Exit.succeed('shutdown')),
        schema,
        supportsTransferables,
        debugInfo,
      }
    }).pipe(Effect.withSpan(`WebChannel:windowChannel`)),
  )
