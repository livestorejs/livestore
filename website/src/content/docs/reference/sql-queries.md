---
title: SQL Queries
sidebar:
  order: 3
---

## Raw SQL queries

LiveStore supports arbitrary SQL queries on top of SQLite. In order for LiveStore to handle the query results correctly, you need to provide the result schema.

```ts
import { queryDb, DbSchema, sql } from '@livestore/livestore'
import { Schema } from 'effect'

const table = DbSchema.table('my_table', {
	id: DbSchema.text({ primaryKey: true }),
	name: DbSchema.text(),
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
const table = DbSchema.table('my_table', {
	id: DbSchema.text({ primaryKey: true }),
	name: DbSchema.text(),
})

table.query.select('name')
table.query.where('name', '==', 'Alice')
table.query.where({ name: 'Alice' })
table.query.orderBy('name', 'desc').offset(10).limit(10)
table.query.count().where('name', 'like', '%Ali%')

// Automatically inserts a row if it doesn't exist
table.query.row('123', { insertValues: { name: 'Bob' } })
```

## Derived mutations
