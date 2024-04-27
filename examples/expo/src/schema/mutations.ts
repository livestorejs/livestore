import { Schema } from '@effect/schema'
import { defineMutation, sql } from '@livestore/livestore'

import { Filter } from '../types.ts'

export const addTodo = defineMutation(
  'addTodo',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
)

export const completeTodo = defineMutation(
  'completeTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)

export const uncompleteTodo = defineMutation(
  'uncompleteTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = false WHERE id = $id`,
)

export const deleteTodo = defineMutation(
  'deleteTodo',
  Schema.Struct({ id: Schema.String }),
  sql`DELETE FROM todos WHERE id = $id`,
)

export const clearCompleted = defineMutation(
  'clearCompleted',
  Schema.Void,
  sql`DELETE FROM todos WHERE completed = true`,
)

export const clearAll = defineMutation('clearAll', Schema.Void, sql`DELETE FROM todos`)

export const updateNewTodoText = defineMutation(
  'updateNewTodoText',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newTodoText = $text`,
)

export const setFilter = defineMutation(
  'setFilter',
  Schema.Struct({ filter: Filter }),
  sql`UPDATE app SET filter = $filter`,
)
