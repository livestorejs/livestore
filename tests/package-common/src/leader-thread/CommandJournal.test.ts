import { expect, assert } from 'vitest'

import { CommandJournal, Eventlog } from '@livestore/common/leader-thread'
import { makeCommandInstance } from '@livestore/common/schema'
import { loadSqlite3Wasm } from '@livestore/sqlite-wasm/load-wasm'
import { sqliteDbFactory } from '@livestore/sqlite-wasm/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, FileSystem } from '@livestore/utils/effect'

const makeCommandJournal = Effect.gen(function* () {
  const sqlite3 = yield* Effect.promise(() => loadSqlite3Wasm())
  const makeSqliteDb = yield* sqliteDbFactory({ sqlite3 })
  const dbEventlog = yield* makeSqliteDb({ _tag: 'in-memory' })
  yield* Eventlog.initEventlogDb(dbEventlog)
  return CommandJournal.make(dbEventlog)
}).pipe(Effect.provide(FileSystem.layerNoop({}))) // We can use a no-op FileSystem since we're using an in-memory database

Vitest.describe('CommandJournal', () => {
  Vitest.scopedLive('`write` and read round-trip', (test) =>
    Effect.gen(function* () {
      const journal = yield* makeCommandJournal

      const cmd = makeCommandInstance({ name: 'CreateTodo', args: { id: 'todo-1', text: 'Buy milk' } })
      yield* journal.write(cmd)

      const entries = yield* journal.entries
      expect(entries).toHaveLength(1)
      assert.isDefined(entries[0])
      expect(entries[0].id).toBe(cmd.id)
      expect(entries[0].name).toBe('CreateTodo')
      expect(entries[0].args).toEqual({ id: 'todo-1', text: 'Buy milk' })
    })
  )

  Vitest.scopedLive('`write` is idempotent', (test) =>
    Effect.gen(function* () {
      const journal = yield* makeCommandJournal

      const cmd = makeCommandInstance({ name: 'CreateTodo', args: { id: 'todo-1', text: 'Buy milk' } })
      yield* journal.write(cmd)
      yield* journal.write(cmd)

      const entries = yield* journal.entries
      expect(entries).toHaveLength(1)
      assert.isDefined(entries[0])
      expect(entries[0].id).toBe(cmd.id)
    })
  )

  Vitest.scopedLive('`entries` returns commands in insertion order', (test) =>
    Effect.gen(function* () {
      const journal = yield* makeCommandJournal

      const cmdA = makeCommandInstance({ name: 'CreateTodo', args: { id: 'a' } })
      const cmdB = makeCommandInstance({ name: 'CompleteTodo', args: { id: 'b' } })
      const cmdC = makeCommandInstance({ name: 'DeleteTodo', args: { id: 'c' } })
      yield* journal.write(cmdA)
      yield* journal.write(cmdB)
      yield* journal.write(cmdC)

      const entries = yield* journal.entries
      expect(entries.map((e) => e.id)).toEqual([cmdA.id, cmdB.id, cmdC.id])
    })
  )

  Vitest.scopedLive('`remove` deletes specified commands and keeps others', (test) =>
    Effect.gen(function* () {
      const journal = yield* makeCommandJournal

      const cmdA = makeCommandInstance({ name: 'A', args: {} })
      const cmdB = makeCommandInstance({ name: 'B', args: {} })
      const cmdC = makeCommandInstance({ name: 'C', args: {} })
      yield* journal.write(cmdA)
      yield* journal.write(cmdB)
      yield* journal.write(cmdC)

      yield* journal.remove([cmdA.id, cmdC.id])

      const entries = yield* journal.entries
      expect(entries).toHaveLength(1)
      assert.isDefined(entries[0])
      expect(entries[0].id).toBe(cmdB.id)
    })
  )

  Vitest.scopedLive('`remove` with empty array is a no-op', (test) =>
    Effect.gen(function* () {
      const journal = yield* makeCommandJournal

      const cmd = makeCommandInstance({ name: 'A', args: {} })
      yield* journal.write(cmd)

      yield* journal.remove([])

      const entries = yield* journal.entries
      expect(entries).toHaveLength(1)
    })
  )

  Vitest.scopedLive('`destroy` clears all entries', (test) =>
    Effect.gen(function* () {
      const journal = yield* makeCommandJournal

      yield* journal.write(makeCommandInstance({ name: 'A', args: {} }))
      yield* journal.write(makeCommandInstance({ name: 'B', args: {} }))
      yield* journal.write(makeCommandInstance({ name: 'C', args: {} }))

      yield* journal.destroy

      const entries = yield* journal.entries
      expect(entries).toHaveLength(0)
    })
  )
})
