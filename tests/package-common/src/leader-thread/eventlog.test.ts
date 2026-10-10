import { expect } from 'vitest'

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
        LiveStoreEvent.Client.Encoded.make({
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
})
