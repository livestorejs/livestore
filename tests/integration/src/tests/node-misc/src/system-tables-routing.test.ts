import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeAdapter } from '@livestore/adapter-node'
import { makeSchema, State, SystemTables } from '@livestore/common/schema'
import { createStore } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testFileDir = path.dirname(fileURLToPath(import.meta.url))
const TMP_STORE_DIR = path.resolve(testFileDir, '..', 'tmp')

const withTestCtx = Vitest.makeWithTestCtx({ timeout: IS_CI ? 600_000 : 900_000 })

Vitest.describe('system-tables-routing', () => {
  Vitest.scopedLive('system table query builder routes to correct backend db', (test) =>
    Effect.gen(function* () {
      const tableA = State.SQLite.table({
        name: 'a_items',
        columns: { id: State.SQLite.text({ primaryKey: true }) },
      })
      const tableB = State.SQLite.table({
        name: 'b_items',
        columns: { id: State.SQLite.text({ primaryKey: true }) },
      })

      const backendA = State.SQLite.makeBackend({ id: 'a', tables: { tableA }, materializers: {} })
      const backendB = State.SQLite.makeBackend({ id: 'b', tables: { tableB }, materializers: {} })
      const schema = makeSchema({
        state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
        events: {},
      })

      const storeId = nanoid(10)
      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test-client' })
      const store = yield* createStore({ adapter, schema, storeId })

      const systemTablesA = SystemTables.forStateBackend(schema, 'a')
      const systemTablesB = SystemTables.forStateBackend(schema, 'b')

      const aHasAItems = store.query(systemTablesA.schemaMetaTable.where({ tableName: 'a_items' }))
      const aHasBItems = store.query(systemTablesA.schemaMetaTable.where({ tableName: 'b_items' }))
      const bHasAItems = store.query(systemTablesB.schemaMetaTable.where({ tableName: 'a_items' }))
      const bHasBItems = store.query(systemTablesB.schemaMetaTable.where({ tableName: 'b_items' }))

      expect(aHasAItems.length).toBe(1)
      expect(aHasBItems.length).toBe(0)
      expect(bHasAItems.length).toBe(0)
      expect(bHasBItems.length).toBe(1)

      yield* store.shutdown()
    }).pipe(withTestCtx(test)),
  )
})
