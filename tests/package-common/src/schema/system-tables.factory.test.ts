import { makeSchema, State, SystemTables } from '@livestore/common/schema'
import { describe, expect, test } from 'vitest'

describe('state system table factory', () => {
  test('state system table defs are unique per backend and carry correct backend id', () => {
    const tableA = State.SQLite.table({
      name: 'a_items',
      columns: { id: State.SQLite.text({ primaryKey: true }) },
    })

    const tableB = State.SQLite.table({
      name: 'b_items',
      columns: { id: State.SQLite.text({ primaryKey: true }) },
    })

    const backendA = State.SQLite.makeBackend({
      id: 'a',
      tables: { tableA },
      materializers: {},
    })

    const backendB = State.SQLite.makeBackend({
      id: 'b',
      tables: { tableB },
      materializers: {},
    })

    const schema = makeSchema({
      state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
      events: {},
    })

    const systemTablesA = SystemTables.forStateBackend(schema, 'a')
    const systemTablesB = SystemTables.forStateBackend(schema, 'b')

    expect(systemTablesA.schemaMetaTable).not.toBe(systemTablesB.schemaMetaTable)
    expect(systemTablesA.sessionChangesetMetaTable).not.toBe(systemTablesB.sessionChangesetMetaTable)

    expect(State.SQLite.getTableBackendId(systemTablesA.schemaMetaTable)).toBe('a')
    expect(State.SQLite.getTableBackendId(systemTablesB.schemaMetaTable)).toBe('b')
  })
})
