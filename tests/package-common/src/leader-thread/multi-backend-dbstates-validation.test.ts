import type { SqliteDb } from '@livestore/common'
import { makeLeaderThreadLayer } from '@livestore/common/leader-thread'
import { Events, makeSchema, State } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { type MakeNodeSqliteDb, sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Cause, Effect, FetchHttpClient, Layer, Schema, WebChannel } from '@livestore/utils/effect'
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

const schema = makeSchema({
  state: State.SQLite.makeMultiState({ backends: [backendA, backendB] }),
  events: { ...eventsA, ...eventsB },
})

const withTestCtx = Vitest.makeWithTestCtx({
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
    schema,
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
    }).pipe(withTestCtx(test)),
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
    }).pipe(withTestCtx(test)),
  )
})
