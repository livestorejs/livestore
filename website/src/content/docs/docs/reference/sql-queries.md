---
title: SQL Queries
sidebar:
  order: 3
---

## Raw SQL queries

LiveStore supports arbitrary SQL queries on top of SQLite. In order for LiveStore to handle the query results correctly, you need to provide the result schema.

```ts
import { queryDb, State, Schema, sql } from '@livestore/livestore'

const table = State.SQLite.table({
	name: 'my_table',
	columns: {
		id: State.SQLite.text({ primaryKey: true }),
		name: State.SQLite.text(),
	},
})

const filtered$ = queryDb({
	query: sql`select * from my_table where name = 'Alice'`,
	schema: Schema.Array(table.schema),
})

const count$ = queryDb({
	query: sql`select count(*) as count from my_table`,
	schema: Schema.Struct({ count: Schema.Number }).pipe(Schema.pluck('count'), Schema.Array, Schema.headOrElse()),
})
```

## Query builder

LiveStore also provides a small query builder for the most common queries. The query builder automatically derives the appropriate result schema internally.

```ts
const table = State.SQLite.table({
	name: 'my_table',
	columns: {
		id: State.SQLite.text({ primaryKey: true }),
		name: State.SQLite.text(),
	},
})

// Read queries
table.select('name')
table.where('name', '==', 'Alice')
table.where({ name: 'Alice' })
table.orderBy('name', 'desc').offset(10).limit(10)
table.count().where('name', 'like', '%Ali%')

// Write queries
table.insert({ id: '123', name: 'Bob' })
table.update({ name: 'Alice' }).where({ id: '123' })
table.delete().where({ id: '123' })
```

## Derived mutations
