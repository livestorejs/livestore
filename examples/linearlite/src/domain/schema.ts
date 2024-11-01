import { DbSchema, makeSchema } from '@livestore/livestore'
import { PriorityType, StatusType } from '../types/issue'
import { Schema } from 'effect'
import * as mutations from './mutations'

export { mutations }

const issue = DbSchema.table(
  'issue',
  {
    id: DbSchema.text({ primaryKey: true }),
    title: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    priority: DbSchema.text({ schema: PriorityType, default: 'none' }),
    status: DbSchema.text({ schema: StatusType, default: 'todo' }),
    created: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    deleted: DbSchema.integer({ nullable: true }),
    modified: DbSchema.integer({ default: { sql: `(strftime('%s','now'))` } }),
    kanbanorder: DbSchema.text({ nullable: false, default: '' }),
  },
  {
    indexes: [
      { name: 'issue_kanbanorder', columns: ['kanbanorder'] },
      { name: 'issue_created', columns: ['created'] },
    ],
    deriveMutations: true,
  },
)

const OrderDirection = Schema.Literal('asc', 'desc').annotations({ title: 'OrderDirection' })
export type OrderDirection = typeof OrderDirection.Type

const OrderBy = Schema.Literal('priority', 'status', 'created', 'modified').annotations({ title: 'OrderBy' })
export type OrderBy = typeof OrderBy.Type

const description = DbSchema.table(
  'description',
  {
    // TODO: id is also a foreign key to issue
    id: DbSchema.text({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    deleted: DbSchema.integer({ nullable: true }),
  },
  { deriveMutations: true },
)

const comment = DbSchema.table(
  'comment',
  {
    id: DbSchema.text({ primaryKey: true }),
    body: DbSchema.text({ default: '' }),
    creator: DbSchema.text({ default: '' }),
    issueId: DbSchema.text(),
    created: DbSchema.integer(),
    deleted: DbSchema.integer({ nullable: true }),
  },
  {
    indexes: [{ name: 'issue_id', columns: ['issueId'] }],
  },
)

export const FilterState = Schema.Struct({
  orderBy: OrderBy,
  orderDirection: OrderDirection,
  status: Schema.optional(Schema.Array(StatusType)),
  priority: Schema.optional(Schema.Array(PriorityType)),
  query: Schema.optional(Schema.String),
})

export type FilterState = typeof FilterState.Type

export const filterStateTable = DbSchema.table(
  'filter_state',
  DbSchema.json({ schema: FilterState, default: { orderBy: 'created', orderDirection: 'desc' } }),
  { deriveMutations: { enabled: true, localOnly: true } },
)

export type Issue = DbSchema.FromTable.RowDecoded<typeof issue>
export type Description = DbSchema.FromTable.RowDecoded<typeof description>
export type Comment = DbSchema.FromTable.RowDecoded<typeof comment>

export const tables = { issue, description, comment, filterState: filterStateTable }

export const schema = makeSchema({ tables, mutations, migrations: { strategy: 'from-mutation-log' } })
