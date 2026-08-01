import { expect } from 'vitest'

import { SqliteError } from '@livestore/common'
import { Eventlog } from '@livestore/common/leader-thread'
import { EventSequenceNumber, LiveStoreEvent } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

Vitest.describe.concurrent('deleteEvents', () => {
  Vitest.live('deletes every rebase generation at a logical event position', (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* Eventlog.initEventlogDb(dbEventlog)

      const makeEvent = (rebaseGeneration: number) =>
        LiveStoreEvent.Client.EncodedWithMeta.make({
          name: 'todoCreated',
          args: { id: `todo-${rebaseGeneration}`, text: 'todo', completed: false },
          seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 1, rebaseGeneration }),
          parentSeqNum: EventSequenceNumber.Client.ROOT,
          clientId: 'client-1',
          sessionId: 'session-1',
        })

      const generations = [makeEvent(0), makeEvent(1)]
      yield* Effect.forEach(
        generations,
        (event) => Eventlog.insertIntoEventlog(event, dbEventlog, 0, event.clientId, event.sessionId),
        { discard: true },
      )

      yield* Eventlog.deleteEvents(dbEventlog, [generations[0]!.seqNum])

      expect(dbEventlog.select('SELECT * FROM eventlog')).toEqual([])
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )

  Vitest.live('rolls back earlier delete chunks when a later chunk fails', (test) =>
    Effect.gen(function* () {
      const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
      const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
      const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
      yield* Eventlog.initEventlogDb(dbEventlog)

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
      expect(dbEventlog.select<{ count: number }>('SELECT COUNT(*) AS count FROM eventlog')[0]!.count).toEqual(101)
    }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer), Vitest.withTestCtx(test)),
  )
})
