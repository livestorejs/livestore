import { STATE_HEAD_META_TABLE, StateHead } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const withNodeFs = <R, E, A>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

Vitest.describe.concurrent('StateHead', () => {
  Vitest.scopedLive('set creates missing state-head table for legacy snapshots', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
        const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
        const dbState = yield* makeSqliteDb({ _tag: 'in-memory' })
        const stateHead = StateHead.make({ dbState })
        const head = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })

        yield* stateHead.set(head)

        const tableRows = dbState.select<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${STATE_HEAD_META_TABLE}'`,
        )
        const storedHead = yield* stateHead.get()

        expect(tableRows).toEqual([{ name: STATE_HEAD_META_TABLE }])
        expect(storedHead).toEqual(head)
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
})
