import { expect } from 'vitest'

import { type BootStatus, StateHead } from '@livestore/common'
import {
  configureConnection,
  Eventlog,
  LeaderThreadCtx,
  makeLeaderThreadLayer,
  makeMaterializeEvent,
  recreateDb,
  ShutdownChannel,
} from '@livestore/common/leader-thread'
import { Events, LiveStoreEvent, makeSchema, State, SystemTables } from '@livestore/common/schema'
import { EventFactory } from '@livestore/common/testing'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  Deferred,
  Effect,
  Exit,
  FetchHttpClient,
  Fiber,
  FileSystem,
  Layer,
  Queue,
  Schema,
  WebChannel,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

for (const failure of ['init', 'pre', 'replay', 'replay-after-batch', 'post', 'interrupt'] as const) {
  Vitest.live(`rebuilds surviving partial state after ${failure} failure on common leader boot (#1605)`, (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped()
      const services = yield* Effect.context()
      const dbEventlog = yield* Effect.acquireRelease(makeSqliteDb({ _tag: 'in-memory' }), (db) =>
        Effect.sync(() => db.close()),
      )
      const openState = Effect.acquireRelease(
        makeSqliteDb({
          _tag: 'fs',
          directory,
          fileName: 'state.db',
          configureDb: (db) => configureConnection(db, { foreignKeys: true }).pipe(Effect.runSyncWith(services)),
        }),
        (db) => Effect.sync(() => db.close()),
      )
      const todos = State.SQLite.table({
        name: 'rebuild_todos',
        columns: { id: State.SQLite.text({ primaryKey: true }) },
      })
      const events = { created: Events.synced({ name: 'created', schema: Schema.Struct({ id: Schema.String }) }) }
      const factory = EventFactory.makeFactory(events)({ client: EventFactory.clientIdentity('test') })
      const eventIds = Array.from({ length: 5 }, (_, i) => `todo-${i + 1}`)
      yield* Eventlog.initEventlogDb(dbEventlog)
      for (const id of eventIds) {
        const event = new LiveStoreEvent.Client.EncodedWithMeta({
          ...LiveStoreEvent.Global.toClientEncoded(factory.created.next({ id })),
        })
        yield* Eventlog.insertIntoEventlog(
          event,
          dbEventlog,
          Schema.hash(events.created.schema),
          event.clientId,
          event.sessionId,
        )
      }
      const readEventlog = () => ({
        events: dbEventlog.select(SystemTables.eventlogMetaTable),
        sync: dbEventlog.select(SystemTables.syncStatusTable),
      })
      const before = readEventlog()
      const enteredPost = yield* Deferred.make<void>()
      let shouldFail = true
      const attemptedEvents: string[] = []
      const attemptedHooks: string[] = []
      const failHook = (stage: string) => {
        attemptedHooks.push(stage)
        if (shouldFail === true && failure === stage) throw new Error(`Injected ${stage} failure`)
      }
      const schema = makeSchema({
        events,
        state: State.SQLite.makeState({
          tables: { todos },
          materializers: State.SQLite.materializers(events, {
            created: ({ id }) => {
              attemptedEvents.push(id)
              if (
                shouldFail === true &&
                (failure === 'replay' || failure === 'replay-after-batch') &&
                id === 'todo-3'
              ) {
                throw new Error('Injected replay failure')
              }
              return todos.insert({ id })
            },
          }),
          migrations: {
            hooks: {
              init: (db) => {
                // Objects outside the declared schema must also disappear before retry.
                db.execute('CREATE TABLE scratch (id INTEGER PRIMARY KEY)')
                db.execute('INSERT INTO scratch VALUES (1)')
                failHook('init')
              },
              pre: (db) => {
                db.execute('INSERT INTO scratch VALUES (2)')
                failHook('pre')
              },
              post: (db) =>
                Effect.gen(function* () {
                  db.execute('INSERT INTO scratch VALUES (3)')
                  yield* Effect.sync(() => failHook('post'))
                  if (shouldFail === true && failure === 'interrupt') {
                    yield* Deferred.succeed(enteredPost, undefined)
                    return yield* Effect.never
                  }
                  db.execute(todos.insert({ id: 'post-hook' }))
                }),
            },
          },
        }),
      })
      const boot = Effect.gen(function* () {
        const persistedState = yield* openState
        // Model adapters whose failure cleanup leaves the persisted file intact.
        const dbState = { ...persistedState, destroy: () => persistedState.close() }
        const shutdown = yield* WebChannel.queueChannelProxy({ schema: ShutdownChannel.All })
        return yield* Effect.gen(function* () {
          const leader = yield* LeaderThreadCtx
          return {
            todos: dbState.select(todos.orderBy('id', 'asc')),
            pending: (yield* leader.syncProcessor.syncState.get).pending.length,
            marker: dbState.select(SystemTables.rebuildMetaTable),
          }
        }).pipe(
          Effect.provide(
            makeLeaderThreadLayer({
              schema,
              storeId: 'rebuild-test',
              clientId: 'test',
              syncPayloadEncoded: undefined,
              syncPayloadSchema: undefined,
              makeSqliteDb,
              syncOptions: undefined,
              dbState,
              dbEventlog,
              devtoolsOptions: { enabled: false },
              shutdownChannel: shutdown.webChannel,
              ...(failure === 'replay-after-batch' ? { params: { stateRebuildBatchSize: 2 } } : {}),
            }).pipe(Layer.provide(StateHead.layer({ dbState })), Layer.provide(FetchHttpClient.layer)),
          ),
        )
      }).pipe(Effect.scoped)

      if (failure === 'interrupt') {
        const fiber = yield* boot.pipe(Effect.forkScoped)
        yield* Deferred.await(enteredPost)
        yield* Fiber.interrupt(fiber)
      } else {
        expect(Exit.isFailure(yield* boot.pipe(Effect.exit))).toBe(true)
      }
      yield* Effect.gen(function* () {
        const partial = yield* openState
        expect(partial.select('SELECT * FROM scratch')).not.toEqual([])
        if (failure !== 'init') expect(partial.select(SystemTables.rebuildMetaTable)).toEqual([])
        if (failure === 'replay' || failure === 'replay-after-batch') {
          const committedEvents = failure === 'replay' ? 0 : 2
          expect(partial.select(todos)).toHaveLength(committedEvents)
          expect(partial.select(SystemTables.sessionChangesetMetaTable)).toHaveLength(committedEvents)
          expect((yield* StateHead.make({ dbState: partial }).get).global).toBe(committedEvents)
        }
        if (failure === 'post' || failure === 'interrupt') expect(partial.select(todos)).toHaveLength(5)
      }).pipe(Effect.scoped)
      expect(readEventlog()).toEqual(before)

      shouldFail = false
      attemptedEvents.length = 0
      attemptedHooks.length = 0
      const recovered = yield* boot
      expect(recovered).toEqual({
        todos: [{ id: 'post-hook' }, ...eventIds.toSorted().map((id) => ({ id }))],
        pending: eventIds.length,
        marker: [{ id: 1 }],
      })
      expect(attemptedEvents).toEqual(eventIds)
      expect(attemptedHooks).toEqual(['init', 'pre', 'post'])
      expect(readEventlog()).toEqual(before)

      shouldFail = true
      attemptedEvents.length = 0
      attemptedHooks.length = 0
      expect(yield* boot).toEqual(recovered)
      expect(attemptedEvents).toEqual([])
      expect(attemptedHooks).toEqual([])
      expect(readEventlog()).toEqual(before)
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
}

Vitest.live('publishes rebuild completion only after an async post hook finishes (#1605)', (test) =>
  Effect.gen(function* () {
    const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
    const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
    const dbState = yield* Effect.acquireRelease(makeSqliteDb({ _tag: 'in-memory' }), (db) =>
      Effect.sync(() => db.close()),
    )
    const dbEventlog = yield* Effect.acquireRelease(makeSqliteDb({ _tag: 'in-memory' }), (db) =>
      Effect.sync(() => db.close()),
    )
    const enteredPost = yield* Deferred.make<void>()
    const releasePost = yield* Deferred.make<void>()
    const schema = makeSchema({
      events: [],
      state: State.SQLite.makeState({
        tables: {},
        materializers: {},
        migrations: {
          hooks: {
            post: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(enteredPost, undefined)
                yield* Deferred.await(releasePost)
              }),
          },
        },
      }),
    })
    yield* Eventlog.initEventlogDb(dbEventlog)
    const bootStatusQueue = yield* Effect.acquireRelease(Queue.unbounded<BootStatus>(), Queue.shutdown)
    const materializeEvent = yield* makeMaterializeEvent({ schema, dbState, dbEventlog }).pipe(
      Effect.provide(StateHead.layer({ dbState })),
    )
    const rebuild = yield* recreateDb({ dbState, dbEventlog, schema, bootStatusQueue, materializeEvent }).pipe(
      Effect.forkScoped,
    )
    yield* Deferred.await(enteredPost)
    expect(dbState.select(SystemTables.rebuildMetaTable)).toEqual([])
    yield* Deferred.succeed(releasePost, undefined)
    yield* Fiber.join(rebuild)
    expect(dbState.select(SystemTables.rebuildMetaTable)).toEqual([{ id: 1 }])
  }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
)
