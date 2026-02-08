import { State } from '@livestore/common/schema'
import { describe, expect, test } from 'vitest'

describe('table backend id fail-fast', () => {
  test('getTableBackendId throws for unassigned table defs', () => {
    const tableDef = State.SQLite.table({
      name: 'unregistered',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
      },
    })

    expect(() => State.SQLite.getTableBackendId(tableDef)).toThrow(/not assigned to a backend/i)
  })

  test('getTableBackendId returns backend id after makeBackend tags it', () => {
    const tableDef = State.SQLite.table({
      name: 'registered',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
      },
    })

    State.SQLite.makeBackend({
      id: 'a',
      tables: { tableDef },
      materializers: {},
    })

    expect(State.SQLite.getTableBackendId(tableDef)).toBe('a')
  })
})
