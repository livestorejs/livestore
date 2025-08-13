import { Effect, Schema, Stream } from '@livestore/utils/effect'

export class UnexpectedError extends Schema.TaggedError<UnexpectedError>()('LiveStore.UnexpectedError', {
  cause: Schema.Defect,
  note: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Any),
}) {
  static mapToUnexpectedError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((cause) => (Schema.is(UnexpectedError)(cause) ? cause : new UnexpectedError({ cause }))),
      Effect.catchAllDefect((cause) => new UnexpectedError({ cause })),
    )

  static mapToUnexpectedErrorStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(
      Stream.mapError((cause) => (Schema.is(UnexpectedError)(cause) ? cause : new UnexpectedError({ cause }))),
    )
}

export class SyncError extends Schema.TaggedError<SyncError>()('LiveStore.SyncError', {
  cause: Schema.Defect,
}) {}

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
