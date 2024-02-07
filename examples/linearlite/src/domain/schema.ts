import { DbSchema, makeCudMutations, makeSchema } from '@livestore/livestore'
import { Priority, PriorityType, Status, StatusType } from '../types/issue'
import { Schema } from '@effect/schema'
import * as mutations from './mutations'

export { mutations }

const issue = DbSchema.table(
  'issue',
  {
    id: DbSchema.text({ primaryKey: true }),
    title: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    priority: DbSchema.text({ schema: PriorityType, default: Priority.NONE }),
    status: DbSchema.text({ schema: StatusType, default: Status.TODO }),
    created: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    modified: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    kanbanorder: DbSchema.text({ nullable: false, default: '' }),
  },
  {
    indexes: [
      { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
      { name: 'issue_created', columns: ['created'] },
    ],
  },
)

const OrderDirection = Schema.literal('asc', 'desc')
export type OrderDirection = Schema.Schema.To<typeof OrderDirection>

const OrderBy = Schema.literal('priority', 'status', 'created', 'modified')
export type OrderBy = Schema.Schema.To<typeof OrderBy>

const description = DbSchema.table('description', {
  // TODO: id is also a foreign key to issue
  id: DbSchema.text({ primaryKey: true }),
  body: DbSchema.text({ default: '' }),
})

const comment = DbSchema.table(
  'comment',
  {
    id: DbSchema.text({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    // TODO: issueId is a foreign key to issue
    issueId: DbSchema.text(),
    created: DbSchema.integer(),
  },
  {
    indexes: [{ name: 'issue_id', columns: ['issueId'] }],
  },
)

export const FilterState = Schema.struct({
  orderBy: OrderBy,
  orderDirection: OrderDirection,
  status: Schema.optional(Schema.array(StatusType)),
  priority: Schema.optional(Schema.array(PriorityType)),
  query: Schema.optional(Schema.string),
})

export const parseFilterStateString = Schema.decodeSync(Schema.parseJson(FilterState))

export type FilterState = Schema.Schema.To<typeof FilterState>

export const filterStateTable = DbSchema.table(
  'filter_state',
  DbSchema.json({ schema: FilterState, default: { orderBy: 'created', orderDirection: 'desc' } }),
  { isSingleton: true },
)

export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
export type Comment = DbSchema.FromTable.RowDecoded<typeof comment>

export const tables = { issue, description, comment, filterStateTable }

export const schema = makeSchema({ tables, mutations })
