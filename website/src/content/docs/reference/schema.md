---
title: Schema
---

LiveStore provides a schema definition language for defining your database tables and mutation definitions. It's also using the [Effect Schema](https://effect.website/docs/schema/introduction/) library.

## Example

```ts
import { Schema } from 'effect'

export const Filter = Schema.Literal('all', 'active', 'completed')

const todos = DbSchema.table(
  'todos',
  {
    id: DbSchema.text({ primaryKey: true }),
    text: DbSchema.text({ default: '' }),
    completed: DbSchema.boolean({ default: false }),
    deleted: DbSchema.integer({ nullable: true }),
  },
  { deriveMutations: true },
)

const app = DbSchema.table(
  'app',
  {
    newTodoText: DbSchema.text({ default: '' }),
    filter: DbSchema.text({ schema: Filter, default: 'all' }),
  },
  { deriveMutations: { enabled: true, localOnly: true } },
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>
export type AppState = DbSchema.FromTable.RowDecoded<typeof app>

export const tables = { todos, app }

export const schema = makeSchema({ tables, mutations, migrations: { strategy: 'from-mutation-log' } })

```