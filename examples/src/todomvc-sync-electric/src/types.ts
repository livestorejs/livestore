import { Schema } from '@livestore/livestore'

export const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type
