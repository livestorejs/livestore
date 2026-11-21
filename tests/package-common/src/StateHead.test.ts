import { expect } from 'vitest'

import { migrateDb, type SqliteDb, StateHead, StateSqliteDb } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { schema } from './leader-thread/fixture.ts'

Vitest.describe.concurrent('StateHead', () => {
  Vitest.live('get returns the root head for an empty current-schema state database', (test) =>
    Effect.gen(function* () {
      const stateHead = yield* makeStateHead(yield* makeDb)

      expect(yield* stateHead.get).toEqual(EventSequenceNumber.Client.ROOT)
    }).pipe(Vitest.withTestCtx(test), Effect.provide(PlatformNode.NodeFileSystem.layer)),
  )

  Vitest.live('set persists a state head', (test) =>
    Effect.gen(function* () {
      const dbState = yield* makeDb
      const head = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })

      const stateHead = yield* makeStateHead(dbState)
      yield* stateHead.set(head)

      expect(yield* stateHead.get).toEqual(head)
    }).pipe(Vitest.withTestCtx(test), Effect.provide(PlatformNode.NodeFileSystem.layer)),
  )

  Vitest.live('set replaces the complete persisted state head', (test) =>
    Effect.gen(function* () {
      const dbState = yield* makeDb
      const stateHead = yield* makeStateHead(dbState)
      const initialHead = EventSequenceNumber.Client.Composite.make({
        global: 3,
        client: 2,
        rebaseGeneration: 1,
      })
      const replacementHead = EventSequenceNumber.Client.Composite.make({
        global: 2,
        client: 4,
        rebaseGeneration: 7,
      })

      yield* stateHead.set(initialHead)
      yield* stateHead.set(replacementHead)

      expect(yield* stateHead.get).toEqual(replacementHead)
    }).pipe(Vitest.withTestCtx(test), Effect.provide(PlatformNode.NodeFileSystem.layer)),
  )
})

const makeDb = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
  yield* migrateDb({ db: dbState, schema })
  return dbState
})

const makeStateHead = (dbState: SqliteDb) =>
  StateHead.make.pipe(Effect.provideService(StateSqliteDb.StateSqliteDb, dbState))
