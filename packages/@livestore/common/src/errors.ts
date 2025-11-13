import { Cause, Effect, Layer, Schema, Stream } from '@livestore/utils/effect'

import * as LiveStoreEvent from './schema/LiveStoreEvent.ts'

export class UnknownError extends Schema.TaggedError<UnknownError>()('LiveStore.UnknownError', {
  cause: Schema.Defect,
  note: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Any),
}) {
  static mapToUnknownError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((cause) => (Schema.is(UnknownError)(cause) ? cause : new UnknownError({ cause }))),
      Effect.catchAllDefect((cause) => new UnknownError({ cause })),
    )

  static mapToUnknownErrorLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
    layer.pipe(
      Layer.catchAllCause((cause) =>
        Cause.isFailType(cause) && Schema.is(UnknownError)(cause.error)
          ? Layer.fail(cause.error)
          : Layer.fail(new UnknownError({ cause: cause })),
      ),
    )

  static mapToUnknownErrorStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(Stream.mapError((cause) => (Schema.is(UnknownError)(cause) ? cause : new UnknownError({ cause }))))
}

export class MaterializerHashMismatchError extends Schema.TaggedError<MaterializerHashMismatchError>()(
  'LiveStore.MaterializerHashMismatchError',
  {
    eventName: Schema.String,
    note: Schema.optionalWith(Schema.String, {
      default: () => 'Please make sure your event materializer is a pure function without side effects.',
    }),
  },
) {}

export class IntentionalShutdownCause extends Schema.TaggedError<IntentionalShutdownCause>()(
  'LiveStore.IntentionalShutdownCause',
  {
    reason: Schema.Literal('devtools-reset', 'devtools-import', 'adapter-reset', 'manual'),
  },
) {}

export class StoreInterrupted extends Schema.TaggedError<StoreInterrupted>()('LiveStore.StoreInterrupted', {
  reason: Schema.String,
}) {}

export class SqliteError extends Schema.TaggedError<SqliteError>()('LiveStore.SqliteError', {
  query: Schema.optional(
    Schema.Struct({
      sql: Schema.String,
      bindValues: Schema.Union(Schema.Record({ key: Schema.String, value: Schema.Any }), Schema.Array(Schema.Any)),
    }),
  ),
  /** The SQLite result code */
  // code: Schema.optional(Schema.Number),
  // Added string support for Expo SQLite (we should refactor this to have a unified error type)
  code: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  /** The original SQLite3 error */
  cause: Schema.Defect,
  note: Schema.optional(Schema.String),
}) {}

export class UnknownEventError extends Schema.TaggedError<UnknownEventError>()('LiveStore.UnknownEventError', {
  event: LiveStoreEvent.AnyEncoded.pipe(Schema.pick('name', 'args', 'seqNum', 'clientId', 'sessionId')),
  reason: Schema.Literal('event-definition-missing', 'materializer-missing'),
  operation: Schema.String,
  note: Schema.optional(Schema.String),
}) {}

export class MaterializeError extends Schema.TaggedError<MaterializeError>()('LiveStore.MaterializeError', {
  cause: Schema.Union(MaterializerHashMismatchError, SqliteError, UnknownEventError),
  note: Schema.optional(Schema.String),
}) {}
