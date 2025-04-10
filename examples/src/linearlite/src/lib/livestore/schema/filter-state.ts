import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { State, Schema } from '@livestore/livestore'

const OrderDirection = Schema.Literal('asc', 'desc').annotations({ title: 'OrderDirection' })
export type OrderDirection = typeof OrderDirection.Type

const OrderBy = Schema.Literal('priority', 'status', 'created', 'modified').annotations({ title: 'OrderBy' })
export type OrderBy = typeof OrderBy.Type

export const FilterState = Schema.Struct({
  orderBy: OrderBy,
  orderDirection: OrderDirection,
  status: Schema.optional(Schema.Array(Status)),
  priority: Schema.optional(Schema.Array(Priority)),
  query: Schema.optional(Schema.String),
})
export type FilterState = typeof FilterState.Type

export const filterState = State.SQLite.clientDocument({
  name: 'filter_state',
  schema: FilterState,
  default: { value: { orderBy: 'created', orderDirection: 'desc' } },
})
