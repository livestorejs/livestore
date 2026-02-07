import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeAdapter } from '@livestore/adapter-node'
import { liveStoreStorageFormatVersion } from '@livestore/common'
import { Events, getStateDbBaseName, makeSchema, State } from '@livestore/common/schema'
import { createStore } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const withTestCtx = Vitest.makeWithTestCtx({ timeout: IS_CI ? 600_000 : 900_000 })

const testFileDir = path.dirname(fileURLToPath(import.meta.url))
const TMP_STORE_DIR = path.resolve(testFileDir, '..', 'tmp')

const tablesA = {
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

Vitest.describe('multi-backend-node-importsnapshot', () => {
  Vitest.scopedLive('restores both backends from importSnapshotsByBackend', (test) =>
    Effect.gen(function* () {
      const sourceStoreId = nanoid(10)
      const sourceAdapter = makeAdapter({
        storage: { type: 'fs', baseDirectory: TMP_STORE_DIR },
        clientId: 'source-client',
      })
      const sourceStore = yield* createStore({ adapter: sourceAdapter, schema, storeId: sourceStoreId })

      sourceStore.commit(events.aItemCreated({ id: 'a-1', title: 'A Item 1' }))
      sourceStore.commit(events.bItemCreated({ id: 'b-1', title: 'B Item 1' }))
      yield* sourceStore.shutdown()

      const sourceStorePath = path.join(TMP_STORE_DIR, sourceStoreId)
      const readStateDbSnapshot = (backendId: 'a' | 'b') =>
        Effect.promise(() =>
          fs.readFile(
            path.join(sourceStorePath, `${getStateDbBaseName({ schema, backendId })}@${liveStoreStorageFormatVersion}.db`),
          ),
        ).pipe(Effect.map((buffer) => new Uint8Array(buffer)))

      const [snapshotA, snapshotB] = yield* Effect.all(
        [readStateDbSnapshot('a'), readStateDbSnapshot('b')],
        { concurrency: 'unbounded' },
      )

      const importedAdapter = makeAdapter({
        storage: {
          type: 'in-memory',
          importSnapshotsByBackend: [
            ['a', snapshotA],
            ['b', snapshotB],
          ],
        },
        clientId: 'imported-client',
      })

      const importedStore = yield* createStore({ adapter: importedAdapter, schema, storeId: nanoid(10) })
      yield* Effect.addFinalizer(() => importedStore.shutdown().pipe(Effect.orDie))

      expect(importedStore.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(importedStore.query(tablesB.items)).toEqual([{ id: 'b-1', title: 'B Item 1' }])
    }).pipe(withTestCtx(test)),
  )
})
