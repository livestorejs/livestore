import { Schema, SessionIdSymbol, State } from '@livestore/livestore'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'

const OrderDirection = Schema.Literal('asc', 'desc').annotations({ title: 'OrderDirection' })
export type OrderDirection = typeof OrderDirection.Type

const OrderBy = Schema.Literal('priority', 'status', 'created', 'modified').annotations({ title: 'OrderBy' })
export type OrderBy = typeof OrderBy.Type

export const FilterState = Schema.Struct({
  orderBy: OrderBy,
  orderDirection: OrderDirection,
  status: Schema.NullOr(Schema.Array(Status)),
  priority: Schema.NullOr(Schema.Array(Priority)),
  query: Schema.NullOr(Schema.String),
}).annotations({ title: 'FilterState' })
export type FilterState = typeof FilterState.Type

export const filterState = State.SQLite.clientDocument({
  name: 'filter_state',
  schema: FilterState,
  default: {
    value: { orderBy: 'created', orderDirection: 'desc', priority: null, query: null, status: null },
    id: SessionIdSymbol,
  },
})
