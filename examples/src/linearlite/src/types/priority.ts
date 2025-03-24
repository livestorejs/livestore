import { Schema } from '@livestore/utils/effect'

export const Priority = Schema.Literal(0, 1, 2, 3, 4).annotations({
  title: 'Priority',
})

export type Priority = typeof Priority.Type
