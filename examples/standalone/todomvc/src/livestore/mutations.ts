import { defineMutation, Schema } from '@livestore/livestore'

import { Filter } from '../types.js'
import { tables } from './schema.js'

export const todoCreated = defineMutation(
  'todoCreated',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  ({ id, text }) => tables.todos.query.insert({ id, text }),
)

export const todoCompleted = defineMutation('todoCompleted', Schema.Struct({ id: Schema.String }), ({ id }) =>
  tables.todos.query.update({ completed: true }).where({ id }),
)

export const todoUncompleted = defineMutation('todoUncompleted', Schema.Struct({ id: Schema.String }), ({ id }) =>
  tables.todos.query.update({ completed: false }).where({ id }),
)

export const todoDeleted = defineMutation(
  'todoDeleted',
  Schema.Struct({ id: Schema.String, deleted: Schema.DateFromNumber }),
  ({ id, deleted }) => tables.todos.query.update({ deleted }).where({ id }),
)

export const todoClearedCompleted = defineMutation(
  'todoClearedCompleted',
  Schema.Struct({ deleted: Schema.DateFromNumber }),
  ({ deleted }) => tables.todos.query.update({ deleted }).where({ completed: true }),
)

export const updatedNewTodoText = defineMutation(
  'updatedNewTodoText',
  Schema.Struct({ text: Schema.String, sessionId: Schema.String }),
  ({ text, sessionId }) => tables.app.query.update({ newTodoText: text }).where({ id: sessionId }),
  { clientOnly: true },
)

export const filterUpdated = defineMutation(
  'setFilter',
  Schema.Struct({ filter: Filter, sessionId: Schema.String }),
  ({ filter, sessionId }) => tables.app.query.update({ filter }).where({ id: sessionId }),
  { clientOnly: true },
)
