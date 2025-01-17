import { Schema } from 'effect'

export const Status = Schema.Literal('backlog', 'todo', 'in_progress', 'done', 'canceled').annotations({
  title: 'Status',
})

export type Status = typeof Status.Type
