---
title: Schema
sidebar:
  order: 2
---

- LiveStore uses schema definitions both to define your database tables (i.e. the read model) and to define your event payloads.
- It's based on the excellent [Effect Schema](https://effect.website/docs/schema/introduction/) library.
- SQLite tables are defined as [STRICT](https://www.sqlite.org/stricttables.html) tables.

## SQLite state schema

LiveStore provides a schema definition language for defining your database tables and mutation definitions. LiveStore automatically migrates your database schema when you change your schema definitions.

### Example

```ts
import { State, makeSchema, Schema } from '@livestore/livestore'

export const Filter = Schema.Literal('all', 'active', 'completed')

const todos = State.SQLite.table(
  'todos',
  {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '' }),
    completed: State.SQLite.boolean({ default: false }),
    deleted: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
  },
)

const app = State.SQLite.table(
  'app',
  {
    newTodoText: State.SQLite.text({ default: '' }),
    filter: State.SQLite.text({ schema: Filter, default: 'all' }),
  },
)

export type Todo = State.SQLite.FromTable.RowDecoded<typeof todos>
export type AppState = State.SQLite.FromTable.RowDecoded<typeof app>

export const tables = { todos, app }

export const schema = makeSchema({ tables, mutations, migrations: { strategy: 'from-eventlog' } })

```

### Schema migrations

Migration strategies:

- `from-eventlog`: Automatically migrate the database to the newest schema and rehydrates the data from the mutation log.
- `hard-reset`: Automatically migrate the database to the newest schema but ignores the mutation log.
- `manual`: Manually migrate the database to the newest schema.

### Client documents

- Meant for convenience
- Client-only
- Goal: Similar ease of use as `React.useState`
- When schema changes in a non-backwards compatible way, previous events are dropped and the state is reset
  - Don't use client documents for sensitive data which must not be lost
- Implies
  - Table with `id` and `value` columns
  - `${MyTable}Set` event + materializer (which are auto-registered)

### Column types

#### Core SQLite column types

- `State.SQLite.text`: A text field, returns `string`.
- `State.SQLite.integer`: An integer field, returns `number`.
- `State.SQLite.real`: A real field (floating point number), returns `number`.
- `State.SQLite.blob`: A blob field (binary data), returns `Uint8Array`.

#### Higher level column types

- `State.SQLite.boolean`: An integer field that stores `0` for `false` and `1` for `true` and returns a `boolean`.
- `State.SQLite.json`: A text field that stores a stringified JSON object and returns a decoded JSON value.
- `State.SQLite.datetime`: A text field that stores dates as ISO 8601 strings and returns a `Date`.
- `State.SQLite.datetimeInteger`: A integer field that stores dates as the number of milliseconds since the epoch and returns a `Date`.


#### Custom column schemas

You can also provide a custom schema for a column which is used to automatically encode and decode the column value.

#### Example: JSON-encoded struct

```ts
import { State, Schema } from '@livestore/livestore'

export const UserMetadata = Schema.Struct({ 
  petName: Schema.String,
  favoriteColor: Schema.Literal('red', 'blue', 'green'),
 })

export const userTable = State.SQLite.table('user', {
  id: State.SQLite.text({ primaryKey: true }),
  name: State.SQLite.text(),
  metadata: State.SQLite.json({ schema: UserMetadata }),
})
```


## Event schema


```ts
import { Events, Schema, sql } from '@livestore/livestore'

export const todoCreated = Events.synced({
  name: 'todoCreated',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
})

export const todoCompleted = Events.synced({
  name: 'todoCompleted',
  schema: Schema.Struct({ id: Schema.String }),
})
```

## Effect Schema

LiveStore uses the [Effect Schema](https://effect.website/docs/schema/introduction/) library to define schemas for the following:

- Read model table column definitions
- Event event payloads definitions
- Query response types

For convenience, LiveStore re-exports the `Schema` type from the `effect` package, which is the same as if you'd import it via `import { Schema } from 'effect'` directly.

### Example

```ts
import { Schema } from '@livestore/livestore'
```