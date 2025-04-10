import { ShutdownChannel } from '@livestore/common/leader-thread'
import { Schema } from '@livestore/utils/effect'

import { tables } from './schema.js'

export const AdapterType = Schema.Literal('in-memory', 'file')

export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
  payload: {
    storeId: Schema.String,
    clientId: Schema.String,
    adapterType: AdapterType,
    params: Schema.Struct({
      leaderPushBatchSize: Schema.optional(Schema.Number),
    }),
  },
  success: Schema.Void,
  failure: Schema.Never,
}) {}

export class CreateTodos extends Schema.TaggedRequest<CreateTodos>()('CreateTodos', {
  payload: {
    count: Schema.Number,
    commitBatchSize: Schema.optional(Schema.Number),
  },
  success: Schema.Void,
  failure: Schema.Never,
}) {}

export class StreamTodos extends Schema.TaggedRequest<StreamTodos>()('StreamTodos', {
  payload: {},
  success: Schema.Array(tables.todo.rowSchema),
  failure: Schema.Never,
}) {}

export class OnShutdown extends Schema.TaggedRequest<OnShutdown>()('OnShutdown', {
  payload: {},
  success: Schema.Void,
  failure: ShutdownChannel.All,
}) {}

export class Request extends Schema.Union(InitialMessage, CreateTodos, StreamTodos, OnShutdown) {}
