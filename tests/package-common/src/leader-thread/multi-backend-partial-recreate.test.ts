import type { SqliteDb } from '@livestore/common'
import { LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { EventSequenceNumber, Events, LiveStoreEvent, makeSchema, State, type StateBackendId, SystemTables } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { type MakeNodeSqliteDb, sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect, FetchHttpClient, Layer, Option, Schema, WebChannel } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

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

const events = { ...eventsA, ...eventsB }
const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
  events,
})

const makeEventFactory = EventFactory.makeFactory(events)

const toEncodedWithMeta = (event: LiveStoreEvent.Global.Encoded): LiveStoreEvent.Client.EncodedWithMeta =>
  LiveStoreEvent.Client.EncodedWithMeta.fromGlobal(event, {
    syncMetadata: Option.none(),
    materializerHashLeader: Option.none(),
    materializerHashSession: Option.none(),
  })

const makeLeaderLayer = ({
  makeSqliteDb,
  dbStates,
  dbEventlog,
}: {
  makeSqliteDb: MakeNodeSqliteDb
  dbStates: Map<StateBackendId, SqliteDb>
  dbEventlog: SqliteDb
}) =>
  Effect.gen(function* () {
    const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

    return makeLeaderThreadLayer({
      schema,
      storeId: 'multi-backend-partial-recreate',
      clientId: 'multi-backend-partial-recreate',
      makeSqliteDb,
      syncOptions: undefined,
      dbStates,
      dbEventlog,
      devtoolsOptions: { enabled: false },
      shutdownChannel,
      syncPayloadEncoded: undefined,
      syncPayloadSchema: undefined,
    }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer)))
  })

const getItems = (db: SqliteDb) => db.select<{ id: string; title: string }>(`SELECT id, title FROM items ORDER BY id`)

const getSessionChangesetCount = (db: SqliteDb) =>
  db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${SystemTables.SESSION_CHANGESET_META_TABLE}`)[0]!.count

Vitest.describe('multi-backend-partial-recreate', () => {
  Vitest.scopedLive('recreates only the missing backend and does not rematerialize other backends', (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeNodeSqliteDb

      const dbStateA1 = yield* makeSqliteDb({ _tag: 'in-memory' })
      const dbStateB1 = yield* makeSqliteDb({ _tag: 'in-memory' })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

      const initialDbStates = new Map<StateBackendId, SqliteDb>([
        ['a', dbStateA1],
        ['b', dbStateB1],
      ])

      const initialLayer = yield* makeLeaderLayer({
        makeSqliteDb,
        dbStates: initialDbStates,
        dbEventlog,
      })

      yield* Effect.gen(function* () {
        const leaderThreadCtx = yield* LeaderThreadCtx
        const eventFactory = makeEventFactory({
          client: EventFactory.clientIdentity('test-client', 'test-session'),
        })

        const eventA = toEncodedWithMeta(eventFactory.aItemCreated.next({ id: 'a-1', title: 'A Item 1' }))
        const eventB = toEncodedWithMeta(eventFactory.bItemCreated.next({ id: 'b-1', title: 'B Item 1' }))

        yield* leaderThreadCtx.materializeEvent(eventA)
        yield* leaderThreadCtx.materializeEvent(eventB)
      }).pipe(Effect.provide(initialLayer), Effect.scoped)

      expect(getItems(dbStateA1)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(getItems(dbStateB1)).toEqual([{ id: 'b-1', title: 'B Item 1' }])

      const bSessionChangesetsBefore = getSessionChangesetCount(dbStateB1)

      const dbStateA2 = yield* makeSqliteDb({ _tag: 'in-memory' })
      const recreatedDbStates = new Map<StateBackendId, SqliteDb>([
        ['a', dbStateA2],
        ['b', dbStateB1],
      ])

      const recreatedLayer = yield* makeLeaderLayer({
        makeSqliteDb,
        dbStates: recreatedDbStates,
        dbEventlog,
      })

      // Booting with only backend A missing should succeed and leave backend B untouched.
      yield* Effect.gen(function* () {
        const leaderThreadCtx = yield* LeaderThreadCtx
        const localHead = (yield* leaderThreadCtx.syncProcessor.syncState.get).localHead
        expect(localHead).toEqual(
          EventSequenceNumber.Client.Composite.make({
            global: 2,
            client: EventSequenceNumber.Client.DEFAULT,
            rebaseGeneration: EventSequenceNumber.Client.REBASE_GENERATION_DEFAULT,
          }),
        )
      }).pipe(Effect.provide(recreatedLayer), Effect.scoped)

      expect(getItems(dbStateA2)).toEqual([{ id: 'a-1', title: 'A Item 1' }])
      expect(getItems(dbStateB1)).toEqual([{ id: 'b-1', title: 'B Item 1' }])
      expect(getSessionChangesetCount(dbStateB1)).toEqual(bSessionChangesetsBefore)
    }).pipe(Vitest.withTestCtx(test), Effect.provide(PlatformNode.NodeFileSystem.layer)),
  )
})
