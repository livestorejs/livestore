import { expect, vi } from 'vitest'

import { SqliteError } from '@livestore/common'
import { Eventlog } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

const withNodeFs = <R, E, A>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

const setup = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })

  yield* Eventlog.initEventlogDb(dbEventlog)

  return { dbEventlog, sqlite3 }
})

Vitest.describe.concurrent('Eventlog', () => {
  Vitest.live('deleteEvents purges every rebase generation at the logical event position', (test) =>
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

        yield* Eventlog.insertIntoEventlog(
          firstGeneration,
          dbEventlog,
          0,
          firstGeneration.clientId,
          firstGeneration.sessionId,
        )
        yield* Eventlog.insertIntoEventlog(
          secondGeneration,
          dbEventlog,
          0,
          secondGeneration.clientId,
          secondGeneration.sessionId,
        )

        const executeSpy = vi.spyOn(dbEventlog, 'execute')

        yield* Eventlog.deleteEvents(dbEventlog, [firstGeneration.seqNum])

        const executeCalls: ReadonlyArray<ReadonlyArray<unknown>> = executeSpy.mock.calls
        const deleteCall = executeCalls.find(
          ([statement]) => typeof statement === 'string' && statement.startsWith('DELETE FROM eventlog'),
        )
        expect(deleteCall?.[0]).toContain('IN ((?, ?))')
        expect(deleteCall?.[0]).not.toContain('(1, 1, 0)')
        expect(deleteCall?.[1]).toEqual([1, 1])

        const remainingRows = dbEventlog.select<{ seqNumRebaseGeneration: number }>(
          `SELECT seqNumRebaseGeneration FROM eventlog ORDER BY seqNumRebaseGeneration ASC`,
        )

        expect(remainingRows).toEqual([])
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )

  Vitest.live('deleteEvents rolls back earlier chunks when a later chunk fails', (test) =>
    withNodeFs(
      Effect.gen(function* () {
        const { dbEventlog, sqlite3 } = yield* setup
        const events = Array.from({ length: 101 }, (_, index) =>
          LiveStoreEvent.Client.EncodedWithMeta.make({
            name: 'todoCreated',
            args: { id: `todo-${index}`, text: 'todo', completed: false },
            seqNum: EventSequenceNumber.Client.Composite.make({ global: index + 1, client: 1 }),
            parentSeqNum: EventSequenceNumber.Client.ROOT,
            clientId: 'client-1',
            sessionId: 'session-1',
          }),
        )

        yield* Effect.forEach(
          events,
          (event) => Eventlog.insertIntoEventlog(event, dbEventlog, 0, event.clientId, event.sessionId),
          { discard: true },
        )

        const SQLITE_OK = 0
        const SQLITE_DENY = 1
        const SQLITE_DELETE = 9
        let deleteStatementCount = 0

        sqlite3.set_authorizer(
          dbEventlog.metadata.dbPointer,
          (_userData, actionCode, tableName) => {
            if (actionCode === SQLITE_DELETE && tableName === 'eventlog') {
              deleteStatementCount++
              return deleteStatementCount === 2 ? SQLITE_DENY : SQLITE_OK
            }

            return SQLITE_OK
          },
          undefined,
        )

        const error = yield* Eventlog.deleteEvents(
          dbEventlog,
          events.map((event) => event.seqNum),
        ).pipe(Effect.flip)

        expect(error).toBeInstanceOf(SqliteError)
        expect(deleteStatementCount).toEqual(2)
        expect(dbEventlog.select<{ count: number }>('SELECT COUNT(*) AS count FROM eventlog')[0]?.count).toEqual(101)
      }).pipe(Vitest.withTestCtx(test)),
    ),
  )
})
