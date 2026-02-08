import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeAdapter } from '@livestore/adapter-node'
import { liveStoreStorageFormatVersion } from '@livestore/common'
import { Events, getStateDbBaseName, makeSchema, State } from '@livestore/common/schema'
import { createStore, queryDb, signal } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testFileDir = path.dirname(fileURLToPath(import.meta.url))
const TMP_STORE_DIR = path.resolve(testFileDir, '..', 'tmp')

type BackendId = 'a' | 'b'

const withLongTestCtx = Vitest.makeWithTestCtx({ timeout: IS_CI ? 600_000 : 900_000 })
const withShortTestCtx = Vitest.makeWithTestCtx({ timeout: IS_CI ? 90_000 : 60_000 })

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

const makeFsAdapter = (clientId: string) =>
  makeAdapter({
    storage: { type: 'fs', baseDirectory: TMP_STORE_DIR },
    clientId,
  })

const makeFsStore = (clientId: string, storeId = nanoid(10)) =>
  createStore({ adapter: makeFsAdapter(clientId), schema, storeId })

const getStateDbSnapshotPath = (storeId: string, backendId: BackendId) =>
  path.join(TMP_STORE_DIR, storeId, `${getStateDbBaseName({ schema, backendId })}@${liveStoreStorageFormatVersion}.db`)

const nextValue = async <T>(it: AsyncIterator<T>, timeoutMs = 10_000): Promise<T> => {
  const timeoutErrorMessage = `Timed out waiting for next query emission after ${timeoutMs}ms`

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    const nextResultPromise = it.next().then((res) => {
      if (res.done) {
        throw new Error('Iterator completed unexpectedly')
      }

      return res.value
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(timeoutErrorMessage))
      }, timeoutMs)
    })

    return await Promise.race([nextResultPromise, timeoutPromise])
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }
}

const makeItemsQuery = (selectedBackend$: ReturnType<typeof signal<'a' | 'b'>>) => {
  const itemsSchema = Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))

  return queryDb(
    (get) => ({
      query: `SELECT id, title FROM items ORDER BY id`,
      schema: itemsSchema,
      backendId: get(selectedBackend$),
      queriedTables: new Set(['items']),
    }),
    { label: 'items$' },
  )
}

Vitest.describe('multi-backend-node', () => {
  Vitest.scopedLive('routes writes to the correct backend for same table names', (test) =>
    Effect.gen(function* () {
      const store = yield* makeFsStore('test-client')

      expect(store.query(tablesA.items)).toEqual([])
      expect(store.query(tablesB.items)).toEqual([])

      store.commit(events.aItemCreated({ id: 'a-1', title: 'A Item 1' }))

      expect(store.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(store.query(tablesB.items)).toEqual([])

      store.commit(events.bItemCreated({ id: 'b-1', title: 'B Item 1' }))

      expect(store.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(store.query(tablesB.items)).toEqual([{ id: 'b-1', title: 'B Item 1' }])

      yield* store.shutdown()
    }).pipe(withLongTestCtx(test)),
  )

  Vitest.scopedLive('rejects mixed-backend commit batches', (test) =>
    Effect.gen(function* () {
      const store = yield* makeFsStore('test-client')

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
    }).pipe(withLongTestCtx(test)),
  )

  Vitest.scopedLive('persists each backend independently across restart', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const adapter = makeFsAdapter('test-client')

      const store = yield* createStore({ adapter, schema, storeId })

      store.commit(events.aItemCreated({ id: 'a-1', title: 'A Item 1' }))
      store.commit(events.bItemCreated({ id: 'b-1', title: 'B Item 1' }))

      yield* store.shutdown()

      const restartedStore = yield* createStore({ adapter, schema, storeId })

      expect(restartedStore.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(restartedStore.query(tablesB.items)).toEqual([{ id: 'b-1', title: 'B Item 1' }])

      yield* restartedStore.shutdown()
    }).pipe(withLongTestCtx(test)),
  )
})

Vitest.describe('multi-backend-node-importsnapshot', () => {
  Vitest.scopedLive('restores both backends from importSnapshotsByBackend', (test) =>
    Effect.gen(function* () {
      const sourceStoreId = nanoid(10)
      const sourceStore = yield* createStore({
        adapter: makeFsAdapter('source-client'),
        schema,
        storeId: sourceStoreId,
      })

      sourceStore.commit(events.aItemCreated({ id: 'a-1', title: 'A Item 1' }))
      sourceStore.commit(events.bItemCreated({ id: 'b-1', title: 'B Item 1' }))
      yield* sourceStore.shutdown()

      const readStateDbSnapshot = (backendId: BackendId) =>
        Effect.promise(() => fs.readFile(getStateDbSnapshotPath(sourceStoreId, backendId))).pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
        )

      const [snapshotA, snapshotB] = yield* Effect.all([readStateDbSnapshot('a'), readStateDbSnapshot('b')], {
        concurrency: 'unbounded',
      })

      const importedStore = yield* createStore({
        adapter: makeAdapter({
          storage: {
            type: 'in-memory',
            importSnapshotsByBackend: [
              ['a', snapshotA],
              ['b', snapshotB],
            ],
          },
          clientId: 'imported-client',
        }),
        schema,
        storeId: nanoid(10),
      })
      yield* Effect.addFinalizer(() => importedStore.shutdown().pipe(Effect.orDie))

      expect(importedStore.query(tablesA.items)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(importedStore.query(tablesB.items)).toEqual([{ id: 'b-1', title: 'B Item 1' }])
    }).pipe(withLongTestCtx(test)),
  )
})

Vitest.describe('queryDb backendId switching', () => {
  Vitest.scopedLive('switching backendId updates reactive results even if SQL is identical', (test) =>
    Effect.gen(function* () {
      const store = yield* makeFsStore('test-client')
      yield* Effect.addFinalizer(() => store.shutdown().pipe(Effect.orDie))

      store.commit(eventsA.aItemCreated({ id: 'a-1', title: 'A1' }))
      store.commit(eventsB.bItemCreated({ id: 'b-1', title: 'B1' }))

      const selectedBackend$ = signal<'a' | 'b'>('a', { label: 'selectedBackend$' })
      const items$ = makeItemsQuery(selectedBackend$)

      const it = store.subscribe(items$)[Symbol.asyncIterator]()
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await it.return?.()
        }).pipe(Effect.orDie),
      )

      expect(yield* Effect.promise(() => nextValue(it))).toEqual([{ id: 'a-1', title: 'A1' }])

      store.setSignal(selectedBackend$, 'b')

      expect(yield* Effect.promise(() => nextValue(it))).toEqual([{ id: 'b-1', title: 'B1' }])
    }).pipe(withShortTestCtx(test)),
  )

  Vitest.scopedLive('after switching backend, commits in the new backend trigger reactive updates', (test) =>
    Effect.gen(function* () {
      const store = yield* makeFsStore('test-client')
      yield* Effect.addFinalizer(() => store.shutdown().pipe(Effect.orDie))

      const selectedBackend$ = signal<'a' | 'b'>('a', { label: 'selectedBackend$' })
      const items$ = makeItemsQuery(selectedBackend$)

      const it = store.subscribe(items$)[Symbol.asyncIterator]()
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await it.return?.()
        }).pipe(Effect.orDie),
      )

      expect(yield* Effect.promise(() => nextValue(it))).toEqual([])

      store.commit(eventsA.aItemCreated({ id: 'a-1', title: 'A1' }))
      expect(yield* Effect.promise(() => nextValue(it))).toEqual([{ id: 'a-1', title: 'A1' }])

      store.setSignal(selectedBackend$, 'b')
      expect(yield* Effect.promise(() => nextValue(it))).toEqual([])

      store.commit(eventsB.bItemCreated({ id: 'b-1', title: 'B1' }))
      expect(yield* Effect.promise(() => nextValue(it))).toEqual([{ id: 'b-1', title: 'B1' }])
    }).pipe(withShortTestCtx(test)),
  )
})
