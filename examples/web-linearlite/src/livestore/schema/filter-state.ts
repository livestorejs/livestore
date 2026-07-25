import { Schema, State } from '@livestore/livestore'

import { Priority } from '../../types/priority.ts'
import { Status } from '../../types/status.ts'

const OrderDirection = Schema.Literals(['asc', 'desc']).annotate({ title: 'OrderDirection' })
export type OrderDirection = typeof OrderDirection.Type

const OrderBy = Schema.Literals(['priority', 'status', 'created', 'modified']).annotate({ title: 'OrderBy' })
export type OrderBy = typeof OrderBy.Type

export const FilterState = Schema.Struct({
  orderBy: OrderBy,
  orderDirection: OrderDirection,
  status: Schema.NullOr(Schema.Array(Status)),
  priority: Schema.NullOr(Schema.Array(Priority)),
  query: Schema.NullOr(Schema.String),
}).annotate({ title: 'FilterState' })
export type FilterState = typeof FilterState.Type

export const defaultFilterState: FilterState = {
  orderBy: 'created',
  orderDirection: 'desc',
  priority: null,
  query: null,
  status: null,
}

export const filterState = State.SQLite.table({
  name: 'filter_state',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    value: State.SQLite.json({ schema: FilterState }),
  },
})
