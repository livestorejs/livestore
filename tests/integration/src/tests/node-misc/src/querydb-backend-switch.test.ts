import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeAdapter } from '@livestore/adapter-node'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { createStore, queryDb, signal } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const testFileDir = path.dirname(fileURLToPath(import.meta.url))
const TMP_STORE_DIR = path.resolve(testFileDir, '..', 'tmp')

const withTestCtx = Vitest.makeWithTestCtx({ timeout: IS_CI ? 90_000 : 60_000 })

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

const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
  events: { ...eventsA, ...eventsB },
})

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

Vitest.describe('queryDb backendId switching', () => {
  Vitest.scopedLive('switching backendId updates reactive results even if SQL is identical', (test) =>
    Effect.gen(function* () {
      const store = yield* createStore({
        adapter: makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test-client' }),
        schema,
        storeId: nanoid(10),
      })
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
    }).pipe(withTestCtx(test)),
  )

  Vitest.scopedLive('after switching backend, commits in the new backend trigger reactive updates', (test) =>
    Effect.gen(function* () {
      const store = yield* createStore({
        adapter: makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test-client' }),
        schema,
        storeId: nanoid(10),
      })
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
    }).pipe(withTestCtx(test)),
  )
})
