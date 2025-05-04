import type { Deferred, Either, ParseResult } from 'effect'
import { Effect, Predicate, Schema, Stream } from 'effect'

export const WebChannelSymbol = Symbol('WebChannel')
export type WebChannelSymbol = typeof WebChannelSymbol

export const isWebChannel = <MsgListen, MsgSend>(value: unknown): value is WebChannel<MsgListen, MsgSend> =>
  typeof value === 'object' && value !== null && Predicate.hasProperty(value, WebChannelSymbol)

export interface WebChannel<MsgListen, MsgSend, E = never> {
  readonly [WebChannelSymbol]: unknown
  send: (a: MsgSend) => Effect.Effect<void, ParseResult.ParseError | E>
  listen: Stream.Stream<Either.Either<MsgListen, ParseResult.ParseError>, E>
  supportsTransferables: boolean
  closedDeferred: Deferred.Deferred<void>
  shutdown: Effect.Effect<void>
  schema: { listen: Schema.Schema<MsgListen, any>; send: Schema.Schema<MsgSend, any> }
  debugInfo?: Record<string, any>
}

export const DebugPingMessage = Schema.TaggedStruct('WebChannel.DebugPing', {
  message: Schema.String,
  payload: Schema.optional(Schema.String),
})

export const WebChannelPing = Schema.TaggedStruct('WebChannel.Ping', {
  requestId: Schema.String,
})

export const WebChannelPong = Schema.TaggedStruct('WebChannel.Pong', {
  requestId: Schema.String,
})

export const WebChannelHeartbeat = Schema.Union(WebChannelPing, WebChannelPong)

type WebChannelMessages = typeof DebugPingMessage.Type | typeof WebChannelPing.Type | typeof WebChannelPong.Type

export const schemaWithWebChannelMessages = <MsgListen, MsgSend>(
  schema: OutputSchema<MsgListen, MsgSend, any, any>,
): OutputSchema<MsgListen | WebChannelMessages, MsgSend | WebChannelMessages, any, any> => ({
  send: Schema.Union(schema.send, DebugPingMessage, WebChannelPing, WebChannelPong),
  listen: Schema.Union(schema.listen, DebugPingMessage, WebChannelPing, WebChannelPong),
})

export type InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> =
  | Schema.Schema<MsgListen | MsgSend, MsgListenEncoded | MsgSendEncoded>
  | OutputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>

export type OutputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> = {
  listen: Schema.Schema<MsgListen, MsgListenEncoded>
  send: Schema.Schema<MsgSend, MsgSendEncoded>
}

export const mapSchema = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>,
): OutputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> =>
  Predicate.hasProperty(schema, 'send') && Predicate.hasProperty(schema, 'listen')
    ? (schemaWithWebChannelMessages(schema) as any)
    : (schemaWithWebChannelMessages({ send: schema, listen: schema }) as any)

export const listenToDebugPing =
  (channelName: string) =>
  <MsgListen>(
    stream: Stream.Stream<Either.Either<MsgListen, ParseResult.ParseError>, never>,
  ): Stream.Stream<Either.Either<MsgListen, ParseResult.ParseError>, never> =>
    stream.pipe(
      Stream.filterEffect(
        Effect.fn(function* (msg) {
          if (msg._tag === 'Right' && Schema.is(DebugPingMessage)(msg.right)) {
            yield* Effect.logDebug(`WebChannel:ping [${channelName}] ${msg.right.message}`, msg.right.payload)
            return false
          }
          return true
        }),
      ),
    )
