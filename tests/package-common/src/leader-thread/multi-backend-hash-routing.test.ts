import { type MockSyncBackend, makeMaterializerHash, makeMockSyncBackend, type SqliteDb } from '@livestore/common'
import { LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { EventSequenceNumber, Events, LiveStoreEvent, makeSchema, State } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { type MakeNodeSqliteDb, sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Context, Effect, FetchHttpClient, Layer, Queue, Schema, WebChannel } from '@livestore/utils/effect'
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
      previousCount: State.SQLite.integer({ nullable: false }),
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
    'v1.BItemCreated': ({ id, title }, ctx) =>
      tablesB.items.insert({
        id,
        title,
        previousCount: ctx.query(tablesB.items.select('id')).length,
      }),
  }),
})

const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
  events: { ...eventsA, ...eventsB },
})

const makeBackendEventFactory = EventFactory.makeFactory(eventsB)
type BackendEventFactory = ReturnType<typeof makeBackendEventFactory>

class TestContext extends Context.Tag('TestContext')<
  TestContext,
  {
    mockSyncBackend: MockSyncBackend
    dbStateA: SqliteDb
    dbStateB: SqliteDb
    pullQueue: Queue.Queue<any>
    eventFactory: BackendEventFactory
  }
>() {}

const LeaderThreadCtxLive = Effect.gen(function* () {
  const mockSyncBackend = yield* makeMockSyncBackend({ startConnected: true })
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeNodeSqliteDb
  const dbStateA = yield* makeSqliteDb({ _tag: 'in-memory' })
  const dbStateB = yield* makeSqliteDb({ _tag: 'in-memory' })
  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
  const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

  const leaderLayer = makeLeaderThreadLayer({
    schema,
    storeId: 'hash-routing-test',
    clientId: 'hash-routing-test',
    makeSqliteDb,
    syncOptions: {
      backend: () => mockSyncBackend.makeSyncBackend,
    },
    dbStates: new Map([
      ['a', dbStateA],
      ['b', dbStateB],
    ]),
    dbEventlog,
    devtoolsOptions: { enabled: false },
    shutdownChannel,
    syncPayloadEncoded: undefined,
    syncPayloadSchema: undefined,
  }).pipe(Layer.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer)))

  const testLayer = Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const pullQueue = yield* leaderThreadCtx.syncProcessor.pullQueue({ cursor: EventSequenceNumber.Client.ROOT })
    const eventFactory = makeBackendEventFactory({
      client: EventFactory.clientIdentity('mock-backend', 'mock-backend-session'),
    })

    return Layer.succeed(TestContext, {
      mockSyncBackend,
      dbStateA,
      dbStateB,
      pullQueue,
      eventFactory,
    })
  }).pipe(Layer.unwrapScoped, Layer.provide(leaderLayer))

  return leaderLayer.pipe(Layer.merge(testLayer))
}).pipe(Layer.unwrapScoped)

const withTestCtx = Vitest.makeWithTestCtx({
  makeLayer: () => Layer.provideMerge(LeaderThreadCtxLive, PlatformNode.NodeFileSystem.layer),
})

Vitest.describe('multi-backend-hash-routing', () => {
  Vitest.scopedLive('uses per-backend db for pull materializer hash', (test) =>
    Effect.gen(function* () {
      const { dbStateA, dbStateB, eventFactory, mockSyncBackend, pullQueue } = yield* TestContext

      dbStateA.execute(`INSERT INTO items (id, title) VALUES ('seed-a', 'seed')`)

      const remoteEvent = eventFactory.bItemCreated.next({ id: 'b-1', title: 'B Item 1' })
      const remoteClientEncoded = LiveStoreEvent.Global.toClientEncoded(remoteEvent)

      const hashFromBackendA = makeMaterializerHash({ schema, dbState: dbStateA })(remoteClientEncoded)
      const hashFromBackendB = makeMaterializerHash({ schema, dbState: dbStateB })(remoteClientEncoded)
      expect(hashFromBackendA._tag).toBe('Some')
      expect(hashFromBackendB._tag).toBe('Some')
      expect(hashFromBackendA).not.toEqual(hashFromBackendB)

      yield* mockSyncBackend.advance(remoteEvent)

      const pullItem = yield* Queue.take(pullQueue)
      const pulledEvents = pullItem.payload.newEvents ?? []
      const pulledEvent = pulledEvents.find(
        (event: LiveStoreEvent.Client.EncodedWithMeta) => event.name === remoteEvent.name,
      )
      expect(pulledEvent).toBeDefined()
      expect(pulledEvent!.meta.materializerHashLeader._tag).toBe('Some')
      if (hashFromBackendB._tag !== 'Some') {
        throw new Error('Expected hashFromBackendB to be Some.')
      }
      if (pulledEvent!.meta.materializerHashLeader._tag !== 'Some') {
        throw new Error('Expected pulled materializerHashLeader to be Some.')
      }
      expect(pulledEvent!.meta.materializerHashLeader.value).toEqual(hashFromBackendB.value)
    }).pipe(withTestCtx(test)),
  )
})
