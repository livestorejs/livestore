---
title: SQL Queries
sidebar:
  order: 4
---

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

// Upsert queries (insert or update on conflict)
table.insert({ id: '123', name: 'Charlie' }).onConflict('id', 'replace')
table.insert({ id: '456', name: 'Diana' }).onConflict('id', 'update', { name: 'Diana Updated' })
```

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

## Best Practices

- Query results should be treated as immutable/read-only
- For queries which could return many rows, it's recommended to paginate the results
  - Usually both via paginated/virtualized rendering as well as paginated queries
	- You'll get best query performance by using a `WHERE` clause over an indexed column combined with a `LIMIT` clause. Avoid `OFFSET` as it can be slow on large tables
- For very large/complex queries, it can also make sense to implement incremental view maintenance (IVM) for your queries
  - You can for example do this by have a separate table which is a materialized version of your query results which you update manually (and ideally incrementally) as the underlying data changes.