import { Schema } from '@livestore/livestore'

export const Filter = Schema.Literals(['all', 'active', 'completed'])
export type Filter = typeof Filter.Type
