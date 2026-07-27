import { expect } from 'vitest'

import { MATERIALIZATION_JOURNAL_META_TABLE, STATE_HEAD_META_TABLE, StateHead } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

const withNodeFs = <R, E, A>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

const makeDb = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  return yield* makeSqliteDb({ _tag: 'in-memory' })
})

Vitest.describe.concurrent('StateHead', () => {
  Vitest.live('returns ROOT for a genuinely empty state database', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const dbState = yield* makeDb

        expect(yield* StateHead.make({ dbState }).get).toEqual(EventSequenceNumber.Client.ROOT)
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )

  Vitest.live('round-trips the full composite sequence number', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const dbState = yield* makeDb
        const stateHead = StateHead.make({ dbState })
        const head = EventSequenceNumber.Client.Composite.make({ global: 7, client: 3, rebaseGeneration: 2 })

        yield* stateHead.set(head)

        expect(yield* stateHead.get).toEqual(head)
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )

  Vitest.live('set lazily creates the state-head table for a legacy snapshot', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const dbState = yield* makeDb
        const stateHead = StateHead.make({ dbState })
        const head = EventSequenceNumber.Client.Composite.make({ global: 1, client: 2, rebaseGeneration: 3 })

        expect(
          dbState.select<{ name: string }>(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${STATE_HEAD_META_TABLE}'`,
          ),
        ).toEqual([])

        yield* stateHead.set(head)

        expect(
          dbState.select<{ name: string }>(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${STATE_HEAD_META_TABLE}'`,
          ),
        ).toEqual([{ name: STATE_HEAD_META_TABLE }])
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )

  Vitest.live('falls back to the newest legacy session changeset row', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const dbState = yield* makeDb
        dbState.execute(
          `CREATE TABLE ${MATERIALIZATION_JOURNAL_META_TABLE} (
            seqNumGlobal INTEGER NOT NULL,
            seqNumClient INTEGER NOT NULL,
            seqNumRebaseGeneration INTEGER NOT NULL,
            changeset BLOB,
            debug TEXT
          ) STRICT`,
        )
        dbState.execute(
          `INSERT INTO ${MATERIALIZATION_JOURNAL_META_TABLE}
            (seqNumGlobal, seqNumClient, seqNumRebaseGeneration, changeset, debug)
            VALUES (4, 2, 1, NULL, NULL), (5, 1, 3, NULL, NULL), (5, 1, 4, NULL, NULL)`,
        )

        expect(yield* StateHead.make({ dbState }).get).toEqual(
          EventSequenceNumber.Client.Composite.make({ global: 5, client: 1, rebaseGeneration: 4 }),
        )
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
})
