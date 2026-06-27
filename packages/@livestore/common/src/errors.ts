import { Cause, Effect, Layer, Option, Schema, Stream, Struct } from '@livestore/utils/effect'

import * as LiveStoreEvent from './schema/LiveStoreEvent/mod.ts'

export class UnknownError extends Schema.TaggedErrorClass<UnknownError>('~@livestore/common/UnknownError')(
  'UnknownError',
  {
    cause: Schema.Defect(),
    note: Schema.optional(Schema.String),
    payload: Schema.optional(Schema.Any),
  },
) {
  static mapToUnknownError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((cause) => (Schema.is(UnknownError)(cause) === true ? cause : new UnknownError({ cause }))),
      Effect.catchDefect((cause) => new UnknownError({ cause })),
    )

  static mapToUnknownErrorLayer = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
    layer.pipe(
      Layer.catchCause((cause) => {
        const error = Cause.findErrorOption(cause)
        return Option.isSome(error) === true && Schema.is(UnknownError)(error.value) === true
          ? Layer.effectContext<A, UnknownError, never>(Effect.fail(error.value))
          : Layer.effectContext<A, UnknownError, never>(Effect.fail(new UnknownError({ cause: cause })))
      }),
    )

  static mapToUnknownErrorStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(
      Stream.mapError((cause) => (Schema.is(UnknownError)(cause) === true ? cause : new UnknownError({ cause }))),
    )
}

export class MaterializerHashMismatchError extends Schema.TaggedErrorClass<MaterializerHashMismatchError>(
  '~@livestore/common/MaterializerHashMismatchError',
)('MaterializerHashMismatchError', {
  eventName: Schema.String,
  note: Schema.String.pipe(
    Schema.withDecodingDefaultType(
      Effect.succeed('Please make sure your event materializer is a pure function without side effects.'),
    ),
  ),
}) {}

export class IntentionalShutdownCause extends Schema.TaggedErrorClass<IntentionalShutdownCause>(
  '~@livestore/common/IntentionalShutdownCause',
)('IntentionalShutdownCause', {
  reason: Schema.Literals(['devtools-reset', 'devtools-import', 'adapter-reset', 'manual', 'backend-id-mismatch']),
}) {}

export class StoreInterrupted extends Schema.TaggedErrorClass<StoreInterrupted>('~@livestore/common/StoreInterrupted')(
  'StoreInterrupted',
  {
    reason: Schema.String,
  },
) {}

export class SqliteError extends Schema.TaggedErrorClass<SqliteError>('~@livestore/common/SqliteError')('SqliteError', {
  query: Schema.optional(
    Schema.Struct({
      sql: Schema.String,
      bindValues: Schema.Union([Schema.Record(Schema.String, Schema.Any), Schema.Array(Schema.Any)]),
    }),
  ),
  /** The SQLite result code */
  // code: Schema.optional(Schema.Number),
  // Added string support for Expo SQLite (we should refactor this to have a unified error type)
  code: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  /** The original SQLite3 error */
  cause: Schema.Defect(),
  note: Schema.optional(Schema.String),
}) {}

export class UnknownEventError extends Schema.TaggedErrorClass<UnknownEventError>(
  '~@livestore/common/UnknownEventError',
)('UnknownEventError', {
  event: LiveStoreEvent.Client.Encoded.mapFields(Struct.pick(['name', 'args', 'seqNum', 'clientId', 'sessionId'])),
  reason: Schema.Literals(['event-definition-missing', 'materializer-missing']),
  operation: Schema.String,
  note: Schema.optional(Schema.String),
}) {}

export class MaterializeError extends Schema.TaggedErrorClass<MaterializeError>('~@livestore/common/MaterializeError')(
  'MaterializeError',
  {
    cause: Schema.Union([MaterializerHashMismatchError, SqliteError, UnknownEventError]),
    note: Schema.optional(Schema.String),
  },
) {}
