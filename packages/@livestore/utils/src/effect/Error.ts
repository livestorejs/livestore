import { Schema } from '@effect/schema'

export class UnknownError extends Schema.TaggedError<'UnknownError'>()('UnknownError', {
  cause: Schema.Any,
  payload: Schema.optional(Schema.Any),
}) {}
