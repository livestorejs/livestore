import { Eventlog } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

const withNodeFs = <R, E, A>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

const setup = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

  yield* Eventlog.initEventlogDb(dbEventlog)

  return { dbEventlog }
})

Vitest.describe.concurrent('Eventlog', () => {
  Vitest.scopedLive('deleteEvents only deletes the matching rebase generation', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog } = yield* setup

        const makeEvent = (rebaseGeneration: number) =>
          LiveStoreEvent.Client.EncodedWithMeta.make({
            name: 'todoCreated',
            args: { id: `todo-${rebaseGeneration}`, text: 'todo', completed: false },
            seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 1, rebaseGeneration }),
            parentSeqNum: EventSequenceNumber.Client.ROOT,
            clientId: 'client-1',
            sessionId: 'session-1',
          })

        const firstGeneration = makeEvent(0)
        const secondGeneration = makeEvent(1)

        yield* Eventlog.insertIntoEventlog(firstGeneration, dbEventlog, 0, firstGeneration.clientId, firstGeneration.sessionId)
        yield* Eventlog.insertIntoEventlog(
          secondGeneration,
          dbEventlog,
          0,
          secondGeneration.clientId,
          secondGeneration.sessionId,
        )

        Eventlog.deleteEvents(dbEventlog, [firstGeneration.seqNum])

        const remainingRows = dbEventlog.select<{ seqNumRebaseGeneration: number }>(
          `SELECT seqNumRebaseGeneration FROM eventlog ORDER BY seqNumRebaseGeneration ASC`,
        )

        expect(remainingRows.map((_) => _.seqNumRebaseGeneration)).toEqual([1])
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
})
