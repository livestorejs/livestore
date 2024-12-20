import { Schema } from '@livestore/utils/effect'

import { tables } from './schema.js'

export class InitialMessage extends Schema.TaggedRequest<InitialMessage>()('InitialMessage', {
  payload: {
    storeId: Schema.String,
    clientId: Schema.String,
  },
  success: Schema.Void,
  failure: Schema.Never,
}) {}

export class CreateTodos extends Schema.TaggedRequest<CreateTodos>()('CreateTodos', {
  payload: {
    count: Schema.Number,
  },
  success: Schema.Void,
  failure: Schema.Never,
}) {}

export class StreamTodos extends Schema.TaggedRequest<StreamTodos>()('StreamTodos', {
  payload: {},
  success: Schema.Array(tables.todo.schema),
  failure: Schema.Never,
}) {}

export class Request extends Schema.Union(InitialMessage, CreateTodos, StreamTodos) {}
