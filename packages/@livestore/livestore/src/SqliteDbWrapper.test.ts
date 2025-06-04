import { Effect } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { makeTodoMvc } from './utils/tests/fixture.js'

Vitest.describe('SqliteDbWrapper', () => {
  Vitest.describe('getTablesUsed', () => {
    const getTablesUsed = (query: string) =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        return store.sqliteDbWrapper.getTablesUsed(query)
      })

    Vitest.scopedLive('should return the correct tables used', (_test) =>
      Effect.gen(function* () {
        const tablesUsed = yield* getTablesUsed('select * from todos')
        expect(tablesUsed).toEqual(new Set(['todos']))
      }),
    )

    Vitest.scopedLive('should handle DELETE FROM statement without WHERE clause', (_test) =>
      Effect.gen(function* () {
        const tablesUsed = yield* getTablesUsed('DELETE FROM todos')
        expect(tablesUsed).toEqual(new Set(['todos']))
      }),
    )

    Vitest.scopedLive('should handle INSERT with ON CONFLICT clause', (_test) =>
      Effect.gen(function* () {
        const tablesUsed = yield* getTablesUsed(
          'INSERT INTO todos (id, text, completed) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?',
        )
        expect(tablesUsed).toEqual(new Set(['todos']))
      }),
    )
  })
})
