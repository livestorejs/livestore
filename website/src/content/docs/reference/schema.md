---
title: Schema
sidebar:
  order: 2
---

- LiveStore uses schema definitions both to define your database tables (i.e. the read model) and to define your mutations payloads.
- It's based on the excellent [Effect Schema](https://effect.website/docs/schema/introduction/) library.

## Database schema

LiveStore provides a schema definition language for defining your database tables and mutation definitions. LiveStore automatically migrates your database schema when you change your schema definitions.

### Example

```ts
import { DbSchema, makeSchema } from '@livestore/livestore'
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
)

const app = DbSchema.table(
  'app',
  {
    newTodoText: DbSchema.text({ default: '' }),
    filter: DbSchema.text({ schema: Filter, default: 'all' }),
  },
)

export type Todo = DbSchema.FromTable.RowDecoded<typeof todos>
export type AppState = DbSchema.FromTable.RowDecoded<typeof app>

export const tables = { todos, app }

export const schema = makeSchema({ tables, mutations, migrations: { strategy: 'from-mutation-log' } })

```

### Schema migrations

Migration strategies:

- `from-mutation-log`: Automatically migrate the database to the newest schema and rehydrates the data from the mutation log.
- `hard-reset`: Automatically migrate the database to the newest schema but ignores the mutation log.
- `manual`: Manually migrate the database to the newest schema.


## Mutations


```ts
import { defineMutation, sql } from '@livestore/livestore'
import { Schema } from 'effect'

export const addTodo = defineMutation(
  'addTodo',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
)

export const completeTodo = defineMutation(
  'completeTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
)
```

### Example
