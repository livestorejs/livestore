import { Schema } from '@livestore/livestore'

export const Status = Schema.Literals([0, 1, 2, 3, 4]).annotate({
  title: 'Status',
})

export type Status = typeof Status.Type
