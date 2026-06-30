import { type Deferred, Effect, Predicate, Result, Schema, Stream } from 'effect'

export const WebChannelSymbol = Symbol('WebChannel')
export type WebChannelSymbol = typeof WebChannelSymbol

export const isWebChannel = <MsgListen, MsgSend>(value: unknown): value is WebChannel<MsgListen, MsgSend> =>
  typeof value === 'object' && value !== null && Predicate.hasProperty(value, WebChannelSymbol)

export interface WebChannel<MsgListen, MsgSend, E = never> {
  readonly [WebChannelSymbol]: unknown
  send: (a: MsgSend) => Effect.Effect<void, Schema.SchemaError | E>
  listen: Stream.Stream<Result.Result<MsgListen, Schema.SchemaError>, E>
  supportsTransferables: boolean
  closedDeferred: Deferred.Deferred<void>
  shutdown: Effect.Effect<void>
  schema: { listen: Schema.Codec<MsgListen, any>; send: Schema.Codec<MsgSend, any> }
  debugInfo?: Record<string, any> | undefined
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

export const WebChannelHeartbeat = Schema.Union([WebChannelPing, WebChannelPong])

type WebChannelMessages = typeof DebugPingMessage.Type | typeof WebChannelPing.Type | typeof WebChannelPong.Type

export const schemaWithWebChannelMessages = <MsgListen, MsgSend>(
  schema: OutputSchema<MsgListen, MsgSend, any, any>,
): OutputSchema<MsgListen | WebChannelMessages, MsgSend | WebChannelMessages, any, any> => ({
  send: Schema.Union([schema.send, DebugPingMessage, WebChannelPing, WebChannelPong]),
  listen: Schema.Union([schema.listen, DebugPingMessage, WebChannelPing, WebChannelPong]),
})

export type InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> =
  | Schema.Codec<MsgListen | MsgSend, MsgListenEncoded | MsgSendEncoded>
  | OutputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>

export type OutputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> = {
  listen: Schema.Codec<MsgListen, MsgListenEncoded>
  send: Schema.Codec<MsgSend, MsgSendEncoded>
}

export const mapSchema = <MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>(
  schema: InputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded>,
): OutputSchema<MsgListen, MsgSend, MsgListenEncoded, MsgSendEncoded> =>
  Predicate.hasProperty(schema, 'send') === true && Predicate.hasProperty(schema, 'listen') === true
    ? (schemaWithWebChannelMessages(schema) as any)
    : (schemaWithWebChannelMessages({ send: schema, listen: schema }) as any)

export const listenToDebugPing =
  (channelName: string) =>
  <MsgListen>(
    stream: Stream.Stream<Result.Result<MsgListen, Schema.SchemaError>>,
  ): Stream.Stream<Result.Result<MsgListen, Schema.SchemaError>> =>
    stream.pipe(
      Stream.filterEffect(
        Effect.fn(function* (msg) {
          if (Result.isSuccess(msg) === true && Schema.is(DebugPingMessage)(msg.success) === true) {
            yield* Effect.logDebug(`WebChannel:ping [${channelName}] ${msg.success.message}`, msg.success.payload)
            return false
          }
          return true
        }),
      ),
    )
