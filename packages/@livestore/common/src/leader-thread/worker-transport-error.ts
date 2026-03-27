import { ParseResult, Schema, WorkerError } from '@livestore/utils/effect'

const TransportParseErrorEncoded = Schema.Struct({
  _tag: Schema.Literal('ParseError'),
  message: Schema.String,
})

/**
 * Effect's `ParseError` contains schema AST internals that are not stable worker payloads.
 * We only ship the formatted message and reconstruct a real `ParseError` on decode so callers
 * still receive the original transport error type.
 */
export class TransportParseError extends Schema.transformOrFail(
  TransportParseErrorEncoded,
  Schema.instanceOf(ParseResult.ParseError),
  {
    strict: true,
    decode: ({ message }) =>
      ParseResult.succeed(
        new ParseResult.ParseError({
          issue: new ParseResult.Type(Schema.Unknown.ast, undefined, message),
        }),
      ),
    encode: (error) =>
      ParseResult.succeed(
        TransportParseErrorEncoded.make({
          _tag: 'ParseError',
          message: error.message,
        }),
      ),
  },
) {}

export const LeaderWorkerTransportError = Schema.Union(WorkerError.WorkerError, TransportParseError)
export type LeaderWorkerTransportError = typeof LeaderWorkerTransportError.Type
