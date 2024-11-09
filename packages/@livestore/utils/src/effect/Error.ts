import { Schema } from 'effect'

export class UnknownError extends Schema.TaggedError<'UnknownError'>()('UnknownError', {
  cause: Schema.Any,
  payload: Schema.optional(Schema.Any),
}) {}
