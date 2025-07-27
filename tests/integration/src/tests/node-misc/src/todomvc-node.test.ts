import * as inspector from 'node:inspector'
import path from 'node:path'
import { makeAdapter } from '@livestore/adapter-node'
import { createStore } from '@livestore/livestore'
import { IS_CI, shouldNeverHappen } from '@livestore/utils'
import { Duration, Effect, identity } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { OtelLiveDummy } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
// Reuse the same schema from node-sync tests
import { events, schema, tables } from '../../node-sync/schema.ts'

const testTimeout = IS_CI ? 600_000 : 900_000

const DEBUGGER_ACTIVE = Boolean(process.env.DEBUGGER_ACTIVE ?? inspector.url() !== undefined)

const TMP_STORE_DIR = path.join(
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set'),
  'tests',
  'integration',
  'src',
  'tests',
  'node-misc',
  'tmp',
)

Vitest.describe('todomvc-node', () => {
  Vitest.scopedLive('should push pending events to the leader after reboot', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const clientId = 'test-client'

      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId })

      const store = yield* createStore({ adapter, schema, storeId })

      expect(store.query(tables.todo)).toEqual([])

      // Create a new todo
      const newTodoId = nanoid()
      store.commit(events.todoCreated({ id: newTodoId, title: 'Test todo item' }))

      expect(store.query(tables.todo)).toEqual([{ id: newTodoId, title: 'Test todo item' }])

      yield* store.shutdown()

      const sameStore = yield* createStore({ adapter, schema, storeId })

      expect(sameStore.query(tables.todo)).toEqual([{ id: newTodoId, title: 'Test todo item' }])

      sameStore.commit(events.todoCreated({ id: nanoid(), title: 'Test todo item 2' }))

      yield* Effect.sleep(100)

      const syncState = yield* store.syncProcessor.syncState
      expect(syncState.pending.length).toBe(0)

      yield* sameStore.shutdown()
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('should reject operations after shutdown', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test' })
      const store = yield* createStore({ adapter, schema, storeId })

      yield* store.shutdown()

      // All operations should throw after shutdown
      expect(() =>
        store.commit(events.todoCreated({ id: nanoid(), title: 'Test' })),
      ).toThrowErrorMatchingInlineSnapshot(
        `[LiveStore.UnexpectedError: { "cause": "Store has been shut down (while performing \\"commit\\").", "note": "You cannot perform this operation after the store has been shut down.", "payload": undefined }]`,
      )
      expect(() => store.query(tables.todo)).toThrowErrorMatchingInlineSnapshot(
        `[LiveStore.UnexpectedError: { "cause": "Store has been shut down (while performing \\"query\\").", "note": "You cannot perform this operation after the store has been shut down.", "payload": undefined }]`,
      )
      expect(() => store.subscribe(tables.todo, { onUpdate: () => {} })).toThrowErrorMatchingInlineSnapshot(
        `[LiveStore.UnexpectedError: { "cause": "Store has been shut down (while performing \\"subscribe\\").", "note": "You cannot perform this operation after the store has been shut down.", "payload": undefined }]`,
      )
    }).pipe(withCtx(test)),
  )

  Vitest.scopedLive('should handle concurrent commits before shutdown', (test) =>
    Effect.gen(function* () {
      const storeId = nanoid(10)
      const adapter = makeAdapter({ storage: { type: 'fs', baseDirectory: TMP_STORE_DIR }, clientId: 'test' })
      const store = yield* createStore({ adapter, schema, storeId })

      // Commit multiple events in sequence
      store.commit(events.todoCreated({ id: 'todo-1', title: 'Todo 1' }))
      store.commit(events.todoCreated({ id: 'todo-2', title: 'Todo 2' }))
      store.commit(events.todoCreated({ id: 'todo-3', title: 'Todo 3' }))

      expect(store.query(tables.todo)).toHaveLength(3)
      yield* store.shutdown()

      // Verify data persists after shutdown
      const newStore = yield* createStore({ adapter, schema, storeId })
      expect(newStore.query(tables.todo)).toHaveLength(3)
      yield* newStore.shutdown()
    }).pipe(withCtx(test)),
  )
})

const otelLayer = IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName: 'node-sync-test:runner', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TestContext, { suffix }: { suffix?: string } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) => {
    const spanName = `${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`

    return self.pipe(
      // Only provide logger here so we still see timeout logs in the console
      // Effect.provide(makeFileLogger('runner', { testContext })),
      DEBUGGER_ACTIVE
        ? identity
        : Effect.logWarnIfTakesLongerThan({
            duration: testTimeout * 0.8,
            label: `${spanName} approaching timeout (timeout: ${Duration.format(testTimeout)})`,
          }),
      DEBUGGER_ACTIVE ? identity : Effect.timeout(testTimeout),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(spanName),
      Effect.annotateLogs({ suffix }),
      DEBUGGER_ACTIVE ? Effect.provide(otelLayer) : Effect.provide(OtelLiveDummy),
    )
  }
