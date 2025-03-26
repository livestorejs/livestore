import { defineMutation, Schema, sql } from '@livestore/livestore'

import { Filter } from '../types.ts'

export const todoCreated = defineMutation(
  'todoCreated',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
)

export const todoCompleted = defineMutation(
  'todoCompleted',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)

export const todoUncompleted = defineMutation(
  'todoUncompleted',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = false WHERE id = $id`,
)

export const todoDeleted = defineMutation(
  'todoDeleted',
  Schema.Struct({ id: Schema.String, deleted: Schema.DateFromNumber }),
  sql`UPDATE todos SET deleted = $deleted WHERE id = $id`,
)

export const todoClearedCompleted = defineMutation(
  'todoClearedCompleted',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE completed = true`,
)

export const clearAll = defineMutation(
  'clearAll',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted`,
)

export const updatedNewTodoText = defineMutation(
  'updatedNewTodoText',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newTodoText = $text`,
  { clientOnly: true },
)

export const filterUpdated = defineMutation(
  'setFilter',
  Schema.Struct({ filter: Filter }),
  sql`UPDATE app SET filter = $filter`,
  { clientOnly: true },
)
