import { Schema } from '@livestore/utils/effect'

export const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type
