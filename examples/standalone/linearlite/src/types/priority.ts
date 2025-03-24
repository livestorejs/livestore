import { Schema } from '@livestore/livestore'

export const Priority = Schema.Literal(0, 1, 2, 3, 4).annotations({
  title: 'Priority',
})

export type Priority = typeof Priority.Type
