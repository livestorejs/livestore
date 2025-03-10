import { defineMutation, sql } from '@livestore/livestore'
import { Schema } from 'effect'

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

export const deleteTodo = defineMutation(
  'deleteTodo',
  Schema.Struct({ id: Schema.String, deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE id = $id`,
)
