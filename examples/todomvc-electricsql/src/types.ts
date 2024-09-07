import { Schema } from '@effect/schema'

export const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type
