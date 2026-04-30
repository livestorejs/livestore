import { Schema } from 'effect'

import { State } from '@livestore/livestore'

const table = State.SQLite.table({
  name: 'my_table',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
    tags: State.SQLite.json({ schema: Schema.Array(Schema.String), default: [] }),
  },
})

// Read queries
table.select('name')
table.where('name', '=', 'Alice')
table.where({ name: 'Alice' })
table.orderBy('name', 'desc').offset(10).limit(10)
table.count().where('name', 'LIKE', '%Ali%')

// JSON array containment queries
// NOTE: These use SQLite's json_each() which cannot be indexed
table.where({ tags: { op: 'JSON_CONTAINS', value: 'important' } })
table.where({ tags: { op: 'JSON_NOT_CONTAINS', value: 'archived' } })

// Write queries
table.insert({ id: '123', name: 'Bob' })
table.update({ name: 'Alice' }).where({ id: '123' })
table.delete().where({ id: '123' })

// Upserts (insert or update on conflict)
table.insert({ id: '123', name: 'Charlie' }).onConflict('id', 'replace')
table.insert({ id: '456', name: 'Diana' }).onConflict('id', 'update', { name: 'Diana Updated' })
