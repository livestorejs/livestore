import path from 'node:path'
import { makeAdapter } from '@livestore/adapter-node'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { createStore } from '@livestore/livestore'
import { IS_CI, shouldNeverHappen } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const TMP_STORE_DIR = path.join(
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set'),
  'tests',
  'integration',
  'src',
  'tests',
  'node-misc',
  'tmp',
)

const withTestCtx = Vitest.makeWithTestCtx({ timeout: IS_CI ? 600_000 : 900_000 })

const tablesA = {
  // Intentionally same table name as backend B to validate backend-scoped routing.
  items: State.SQLite.table({
    name: 'items',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
    },
  }),
}

const tablesB = {
  items: State.SQLite.table({
    name: 'items',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text(),
    },
  }),
}

const eventsA = {
  aItemCreated: Events.synced({
    name: 'v1.AItemCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const eventsB = {
  bItemCreated: Events.synced({
    name: 'v1.BItemCreated',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const backendA = State.SQLite.makeBackend({
  id: 'a',
  tables: tablesA,
  materializers: State.SQLite.materializers(eventsA, {
    'v1.AItemCreated': ({ id, title }) => tablesA.items.insert({ id, title }),
  }),
})

const backendB = State.SQLite.makeBackend({
  id: 'b',
  tables: tablesB,
  materializers: State.SQLite.materializers(eventsB, {
    'v1.BItemCreated': ({ id, title }) => tablesB.items.insert({ id, title }),
  }),
})

const state = State.SQLite.makeMultiState({ backends: [backendA, backendB] })
const events = { ...eventsA, ...eventsB }
const schema = makeSchema({ state, events })

Vitest.describe('multi-backend-node', () => {
  Vitest.scopedLive('routes writes to the correct backend for same table names', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test-client' })
      const store = yield* createStore({ adapter, schema, storeId })

      expect(store.query(tablesA.items)).toEqual([])
      expect(store.query(tablesB.items)).toEqual([])

      store.commit(events.aItemCreated({ id: 'a-1', title: 'A Item 1' }))

      expect(store.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(store.query(tablesB.items)).toEqual([])

      store.commit(events.bItemCreated({ id: 'b-1', title: 'B Item 1' }))

      expect(store.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(store.query(tablesB.items)).toEqual([{ id: 'b-1', title: 'B Item 1' }])

      yield* store.shutdown()
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('rejects mixed-backend commit batches', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test-client' })
      const store = yield* createStore({ adapter, schema, storeId })

      expect(() =>
        store.commit(
          events.aItemCreated({ id: 'a-1', title: 'A Item 1' }),
          events.bItemCreated({ id: 'b-1', title: 'B Item 1' }),
        ),
      ).toThrowError(/Commit batch spans multiple state backends\./)

      expect(store.query(tablesA.items)).toEqual([])
      expect(store.query(tablesB.items)).toEqual([])

      // Verify the store remains usable after rejecting the invalid commit batch.
      store.commit(events.aItemCreated({ id: 'a-2', title: 'A Item 2' }))
      expect(store.query(tablesA.items)).toEqual([{ id: 'a-2', title: 'A Item 2' }])
      expect(store.query(tablesB.items)).toEqual([])

      yield* store.shutdown()
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('persists each backend independently across restart', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test-client' })

      const store = yield* createStore({ adapter, schema, storeId })

      store.commit(events.aItemCreated({ id: 'a-1', title: 'A Item 1' }))
      store.commit(events.bItemCreated({ id: 'b-1', title: 'B Item 1' }))

      yield* store.shutdown()

      const restartedStore = yield* createStore({ adapter, schema, storeId })

      expect(restartedStore.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(restartedStore.query(tablesB.items)).toEqual([{ id: 'b-1', title: 'B Item 1' }])

      yield* restartedStore.shutdown()
    }).pipe(withTestCtx(test)),
  )
})
