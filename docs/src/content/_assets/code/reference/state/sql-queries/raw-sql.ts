/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet keeps reactive references */
// ---cut---
import { queryDb, Schema, State, sql } from '@livestore/livestore'

const table = State.SQLite.table({
  name: 'my_table',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
  },
})

const filtered$ = queryDb({
  query: sql`select * from my_table where name = 'Alice'`,
  schema: Schema.Array(table.rowSchema),
})

const count$ = queryDb({
  query: sql`select count(*) as count from my_table`,
  schema: Schema.Struct({ count: Schema.Number }).pipe(Schema.pluck('count'), Schema.Array, Schema.headOrElse()),
})
