import { Schema } from '@effect/schema'

export const Filter = Schema.literal('all', 'active', 'completed')

export type Filter = Schema.Schema.Type<typeof Filter>
