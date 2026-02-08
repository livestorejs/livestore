import { type MockSyncBackend, makeMaterializerHash, makeMockSyncBackend, type SqliteDb } from '@livestore/common'
import { LeaderThreadCtx, makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import {
  EventSequenceNumber,
  Events,
  LiveStoreEvent,
  makeSchema,
  State,
  type StateBackendId,
  SystemTables,
} from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { type MakeNodeSqliteDb, sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Context, Cause, Effect, FetchHttpClient, Layer, Option, Queue, Schema, WebChannel } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const makeSimpleSchemaFixture = () => {
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

  return {
    events,
    schema: makeSchema({
      state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
      events,
    }),
  }
}

const makeHashRoutingSchemaFixture = () => {
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

  return {
    eventsB,
    schema: makeSchema({
      state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
      events: { ...eventsA, ...eventsB },
    }),
  }
}

const simpleFixture = makeSimpleSchemaFixture()
const hashFixture = makeHashRoutingSchemaFixture()

const withValidationCtx = Vitest.makeWithTestCtx({
  makeLayer: () => Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer),
})

const makeBaseLayer = ({
  makeSqliteDb,
  dbEventlog,
  dbStates,
  shutdownChannel,
}: {
  makeSqliteDb: MakeNodeSqliteDb
  dbEventlog: SqliteDb
  dbStates: Map<string, SqliteDb>
  shutdownChannel: Parameters<typeof makeLeaderThreadLayer>[0]['shutdownChannel']
}) =>
  makeLeaderThreadLayer({
    schema: simpleFixture.schema,
    storeId: 'dbstates-validation-test',
    clientId: 'dbstates-validation-test',
    makeSqliteDb,
    syncOptions: undefined,
    dbStates,
    dbEventlog,
    devtoolsOptions: { enabled: false },
    shutdownChannel,
    syncPayloadEncoded: undefined,
    syncPayloadSchema: undefined,
  })

const makeEventFactory = EventFactory.makeFactory(simpleFixture.events)

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
      schema: simpleFixture.schema,
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

const makeBackendEventFactory = EventFactory.makeFactory(hashFixture.eventsB)
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
    schema: hashFixture.schema,
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

const withHashRoutingCtx = Vitest.makeWithTestCtx({
  makeLayer: () => Layer.provideMerge(LeaderThreadCtxLive, PlatformNode.NodeFileSystem.layer),
})

Vitest.describe('multi-backend leader-thread', () => {
  Vitest.describe('multi-backend-dbstates-validation', () => {
    Vitest.scopedLive('fails fast when dbStates is missing a schema backend', (test) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeNodeSqliteDb
        const dbStateA = yield* makeSqliteDb({ _tag: 'in-memory' })
        const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
        const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

        const exit = yield* Layer.build(
          makeBaseLayer({
            makeSqliteDb,
            dbEventlog,
            dbStates: new Map([['a', dbStateA]]),
            shutdownChannel,
          }),
        ).pipe(Effect.exit)

        expect(exit._tag).toBe('Failure')
        if (exit._tag !== 'Failure') return

        const prettyCause = Cause.pretty(exit.cause)
        expect(prettyCause).toContain('Missing state DB(s) for backend(s): b')
        expect(prettyCause).toContain('Schema backends: a, b')
        expect(prettyCause).toContain('Provided dbStates: a')
      }).pipe(withValidationCtx(test)),
    )

    Vitest.scopedLive('fails fast when dbStates includes unknown backends', (test) =>
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const makeSqliteDb = (yield* sqliteDbFactory({ sqlite3 })) as MakeNodeSqliteDb
        const dbStateA = yield* makeSqliteDb({ _tag: 'in-memory' })
        const dbStateB = yield* makeSqliteDb({ _tag: 'in-memory' })
        const dbStateExtra = yield* makeSqliteDb({ _tag: 'in-memory' })
        const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
        const shutdownChannel = yield* WebChannel.noopChannel<any, any>()

        const exit = yield* Layer.build(
          makeBaseLayer({
            makeSqliteDb,
            dbEventlog,
            dbStates: new Map([
              ['a', dbStateA],
              ['b', dbStateB],
              ['extra', dbStateExtra],
            ]),
            shutdownChannel,
          }),
        ).pipe(Effect.exit)

        expect(exit._tag).toBe('Failure')
        if (exit._tag !== 'Failure') return

        const prettyCause = Cause.pretty(exit.cause)
        expect(prettyCause).toContain('Provided state DB(s) for unknown backend(s): extra')
        expect(prettyCause).toContain('Schema backends: a, b')
      }).pipe(withValidationCtx(test)),
    )
  })

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

  Vitest.describe('multi-backend-hash-routing', () => {
    Vitest.scopedLive('uses per-backend db for pull materializer hash', (test) =>
      Effect.gen(function* () {
        const { dbStateA, dbStateB, eventFactory, mockSyncBackend, pullQueue } = yield* TestContext

        dbStateA.execute(`INSERT INTO items (id, title) VALUES ('seed-a', 'seed')`)

        const remoteEvent = eventFactory.bItemCreated.next({ id: 'b-1', title: 'B Item 1' })
        const remoteClientEncoded = LiveStoreEvent.Global.toClientEncoded(remoteEvent)

        const hashFromBackendA = makeMaterializerHash({ schema: hashFixture.schema, dbState: dbStateA })(remoteClientEncoded)
        const hashFromBackendB = makeMaterializerHash({ schema: hashFixture.schema, dbState: dbStateB })(remoteClientEncoded)
        expect(hashFromBackendA._tag).toBe('Some')
        expect(hashFromBackendB._tag).toBe('Some')
        expect(hashFromBackendA).not.toEqual(hashFromBackendB)

        yield* mockSyncBackend.advance(remoteEvent)

        const pullItem = yield* Queue.take(pullQueue)
        const pulledEvents = pullItem.payload.newEvents ?? []
        const pulledEvent = pulledEvents.find((event: LiveStoreEvent.Client.EncodedWithMeta) => event.name === remoteEvent.name)
        expect(pulledEvent).toBeDefined()
        expect(pulledEvent!.meta.materializerHashLeader._tag).toBe('Some')
        if (hashFromBackendB._tag !== 'Some') {
          throw new Error('Expected hashFromBackendB to be Some.')
        }
        if (pulledEvent!.meta.materializerHashLeader._tag !== 'Some') {
          throw new Error('Expected pulled materializerHashLeader to be Some.')
        }
        expect(pulledEvent!.meta.materializerHashLeader.value).toEqual(hashFromBackendB.value)
      }).pipe(withHashRoutingCtx(test)),
    )
  })
})
