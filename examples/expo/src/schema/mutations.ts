import { Schema } from '@effect/schema'
import { defineMutation, sql } from '@livestore/livestore'

import { Filter } from '../types.ts'

export const addTodo = defineMutation(
  'addTodo',
  Schema.struct({ id: Schema.string, text: Schema.string }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
)

export const completeTodo = defineMutation(
  'completeTodo',
  Schema.struct({ id: Schema.string }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)

export const uncompleteTodo = defineMutation(
  'uncompleteTodo',
  Schema.struct({ id: Schema.string }),
  sql`UPDATE todos SET completed = false WHERE id = $id`,
)

export const deleteTodo = defineMutation(
  'deleteTodo',
  Schema.struct({ id: Schema.string }),
  sql`DELETE FROM todos WHERE id = $id`,
)

export const clearCompleted = defineMutation(
  'clearCompleted',
  Schema.void,
  sql`DELETE FROM todos WHERE completed = true`,
)

export const updateNewTodoText = defineMutation(
  'updateNewTodoText',
  Schema.struct({ text: Schema.string }),
  sql`UPDATE app SET newTodoText = $text`,
)

export const setFilter = defineMutation(
  'setFilter',
  Schema.struct({ filter: Filter }),
  sql`UPDATE app SET filter = $filter`,
)
