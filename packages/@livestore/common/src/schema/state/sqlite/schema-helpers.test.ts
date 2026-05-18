import { describe, expect, it } from 'vitest'

import * as State from '../mod.ts'
import { getDefaultValuesDecoded, getDefaultValuesEncoded } from './schema-helpers.ts'

describe('schema-helpers', () => {
  it('resolves thunk defaults when decoding values', () => {
    let counter = 0
    const table = State.SQLite.table({
      name: 'sessions',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        token: State.SQLite.text({ default: () => `token-${++counter}` }),
      },
    })

    expect(counter).toBe(0)

    const firstDefaults = getDefaultValuesDecoded(table)
    const secondDefaults = getDefaultValuesDecoded(table)

    expect(firstDefaults.token).toBe('token-1')
    expect(secondDefaults.token).toBe('token-2')
  })

  it('resolves thunk defaults when encoding values', () => {
    let counter = 0
    const table = State.SQLite.table({
      name: 'sessions_encoded',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        token: State.SQLite.text({ default: () => `encoded-${++counter}` }),
      },
    })

    expect(counter).toBe(0)

    const firstDefaults = getDefaultValuesEncoded(table)
    const secondDefaults = getDefaultValuesEncoded(table)

    expect(firstDefaults.token).toBe('encoded-1')
    expect(secondDefaults.token).toBe('encoded-2')
  })
})
