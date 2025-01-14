import { Schema } from 'effect'

export const Priority = Schema.Literal('none', 'urgent', 'high', 'low', 'medium').annotations({
  title: 'Priority',
})

export type Priority = typeof Priority.Type
