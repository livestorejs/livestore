import type { Deferred, Effect, Either, ParseResult, Schema, Stream } from 'effect'
import { Predicate } from 'effect'

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
  schema: { listen: Schema.Schema<MsgListen, any>; send: Schema.Schema<MsgSend, any> }
}
