import { State } from '@livestore/livestore'

const table = State.SQLite.table({
  name: 'my_table',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
  },
})

// Read queries
table.select('name')
table.where('name', '=', 'Alice')
table.where({ name: 'Alice' })
table.orderBy('name', 'desc').offset(10).limit(10)
table.count().where('name', 'LIKE', '%Ali%')

// Write queries
table.insert({ id: '123', name: 'Bob' })
table.update({ name: 'Alice' }).where({ id: '123' })
table.delete().where({ id: '123' })

table.insert({ id: '123', name: 'Charlie' }).onConflict('id', 'replace')
table.insert({ id: '456', name: 'Diana' }).onConflict('id', 'update', { name: 'Diana Updated' })
