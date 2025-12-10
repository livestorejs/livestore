import { Effect, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { queryDb } from '../live-queries/db-query.ts'
import { signal } from '../live-queries/signal.ts'
import { events, makeTodoMvc, tables } from '../utils/tests/fixture.ts'
import { type AfterRefreshInfo, type BeforeChangeEvent, StoreInternalsSymbol } from './store-types.ts'

/**
 * Tests for store lifecycle hooks: `subscribeToBeforeChange` and `subscribeToAfterRefresh`.
 *
 * These hooks are critical for integrating LiveStore with external state management systems
 * like Jotai, Preact Signals, or other reactive libraries that have their own batching mechanisms.
 *
 * Key guarantees these tests verify:
 *
 * 1. **Batch Isolation**: When `onAfterRefresh` fires, the LiveStore reactive batch is COMPLETELY
 *    closed. Any state changes (setSignal, commit) made from within the callback will trigger
 *    a NEW, separate refresh cycle - they will NOT be captured in the batch that just finished.
 *    This is essential because external state sync might trigger reactive updates in the external
 *    system, and those must not accidentally become part of the LiveStore batch.
 *
 * 2. **Lifecycle Order**: `onBeforeChange` fires before mutation, `onAfterRefresh` fires after
 *    all reactive effects have completed. This predictable ordering allows external systems to
 *    safely read old state, prepare for changes, and sync after everything has settled.
 *
 * 3. **No Infinite Loops by Design**: The tests verify that triggering new state changes from
 *    within callbacks works correctly (each triggers a new cycle), which proves the batch
 *    boundary is properly enforced.
 */
Vitest.describe('store hooks', () => {
  Vitest.describe('subscribeToBeforeChange', () => {
    Vitest.scopedLive('should call callback before commit with events', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})

        const receivedEvents: BeforeChangeEvent[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToBeforeChange((event: BeforeChangeEvent) => {
          receivedEvents.push(event)
        })

        store.commit(events.todoCreated({ id: '1', text: 'Test todo', completed: false }))

        expect(receivedEvents).toHaveLength(1)
        expect(receivedEvents[0]!._tag).toBe('commit')
        if (receivedEvents[0]!._tag === 'commit') {
          expect(receivedEvents[0]!.events).toHaveLength(1)
          expect(receivedEvents[0]!.events[0]!.name).toBe('todo.created')
        }

        unsubscribe()
      }),
    )

    Vitest.scopedLive('should call callback before setSignal with signal and value', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const count$ = signal(0, { label: 'count$' })

        const receivedEvents: BeforeChangeEvent[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToBeforeChange((event: BeforeChangeEvent) => {
          receivedEvents.push(event)
        })

        store.setSignal(count$, 42)

        expect(receivedEvents).toHaveLength(1)
        expect(receivedEvents[0]!._tag).toBe('setSignal')
        if (receivedEvents[0]!._tag === 'setSignal') {
          expect(receivedEvents[0]!.signal.label).toBe('count$')
          expect(receivedEvents[0]!.value).toBe(42)
        }

        unsubscribe()
      }),
    )

    Vitest.scopedLive('should call callback before setSignal with updater function (receives computed value)', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const count$ = signal(10, { label: 'count$' })

        const receivedEvents: BeforeChangeEvent[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToBeforeChange((event: BeforeChangeEvent) => {
          receivedEvents.push(event)
        })

        store.setSignal(count$, (prev: number) => prev + 5)

        expect(receivedEvents).toHaveLength(1)
        expect(receivedEvents[0]!._tag).toBe('setSignal')
        if (receivedEvents[0]!._tag === 'setSignal') {
          expect(receivedEvents[0]!.value).toBe(15)
        }

        unsubscribe()
      }),
    )

    Vitest.scopedLive('should not call callback after unsubscribe', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})

        const receivedEvents: BeforeChangeEvent[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToBeforeChange((event: BeforeChangeEvent) => {
          receivedEvents.push(event)
        })

        store.commit(events.todoCreated({ id: '1', text: 'First', completed: false }))
        expect(receivedEvents).toHaveLength(1)

        unsubscribe()

        store.commit(events.todoCreated({ id: '2', text: 'Second', completed: false }))
        expect(receivedEvents).toHaveLength(1)
      }),
    )
  })

  Vitest.describe('subscribeToAfterRefresh', () => {
    Vitest.scopedLive('should call callback after commit refreshes reactive graph', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})

        const receivedInfos: AfterRefreshInfo[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToAfterRefresh((info: AfterRefreshInfo) => {
          receivedInfos.push(info)
        })

        store.commit(events.todoCreated({ id: '1', text: 'Test todo', completed: false }))

        expect(receivedInfos).toHaveLength(1)
        expect(receivedInfos[0]!.reason._tag).toBe('commit')
        expect(receivedInfos[0]!.durationMs).toBeGreaterThanOrEqual(0)
        expect(receivedInfos[0]!.skippedRefresh).toBe(false)

        unsubscribe()
      }),
    )

    Vitest.scopedLive('should call callback after setSignal refreshes reactive graph', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const count$ = signal(0, { label: 'count$' })

        const receivedInfos: AfterRefreshInfo[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToAfterRefresh((info: AfterRefreshInfo) => {
          receivedInfos.push(info)
        })

        store.setSignal(count$, 42)

        expect(receivedInfos.length).toBeGreaterThanOrEqual(1)

        unsubscribe()
      }),
    )

    Vitest.scopedLive('should not call callback when skipRefresh is true, but call after manualRefresh', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})

        const receivedInfos: AfterRefreshInfo[] = []
        const unsubscribeAfterRefresh = store[StoreInternalsSymbol].subscribeToAfterRefresh(
          (info: AfterRefreshInfo) => {
            receivedInfos.push(info)
          },
        )

        // Create an active subscription so that effects will be deferred when skipRefresh is true
        const todos$ = queryDb({
          query: 'SELECT * FROM todos',
          schema: Schema.Array(tables.todos.rowSchema),
          queriedTables: new Set(['todos']),
          label: 'todos$',
        })
        const unsubscribeQuery = store.subscribe(todos$, () => {})

        store.commit({ skipRefresh: true }, events.todoCreated({ id: '1', text: 'Test', completed: false }))

        // No refresh callback should fire since skipRefresh was true
        expect(receivedInfos).toHaveLength(0)

        store.manualRefresh()

        // After manualRefresh, the deferred effects should run and trigger the callback
        expect(receivedInfos.length).toBeGreaterThanOrEqual(1)

        unsubscribeQuery()
        unsubscribeAfterRefresh()
      }),
    )

    Vitest.scopedLive('should not call callback after unsubscribe', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})

        const receivedInfos: AfterRefreshInfo[] = []
        const unsubscribe = store[StoreInternalsSymbol].subscribeToAfterRefresh((info: AfterRefreshInfo) => {
          receivedInfos.push(info)
        })

        store.commit(events.todoCreated({ id: '1', text: 'First', completed: false }))
        const countAfterFirst = receivedInfos.length

        unsubscribe()

        store.commit(events.todoCreated({ id: '2', text: 'Second', completed: false }))
        expect(receivedInfos.length).toBe(countAfterFirst)
      }),
    )

    /**
     * CRITICAL TEST FOR EXTERNAL STATE SYNC (Jotai, Preact Signals, etc.)
     *
     * This test verifies that when `onAfterRefresh` fires, the batch is truly closed.
     * Any `setSignal` call from within the callback MUST trigger a new, separate refresh
     * cycle - it must NOT be captured in the batch that just completed.
     *
     * Why this matters: When syncing LiveStore state to an external reactive system,
     * that sync might trigger reactive updates in the external system. If those updates
     * somehow fed back into LiveStore, they must start a fresh cycle, not corrupt the
     * batch that triggered the sync.
     *
     * The test increments a counter from 1→2→3 inside the callback, verifying we see
     * exactly 3 distinct refresh cycles (not 1 batched cycle).
     */
    Vitest.scopedLive('setSignal in onAfterRefresh triggers a NEW refresh cycle (not captured in current batch)', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const counter$ = signal(0, { label: 'counter$' })

        const refreshCycles: number[] = []
        let currentCounterValue = 0

        const unsubscribe = store[StoreInternalsSymbol].subscribeToAfterRefresh((_info: AfterRefreshInfo) => {
          currentCounterValue = store.query(counter$)
          refreshCycles.push(currentCounterValue)

          // If counter is below threshold, increment it
          // This should trigger a NEW refresh cycle, not be part of the current one
          if (currentCounterValue < 3) {
            store.setSignal(counter$, currentCounterValue + 1)
          }
        })

        // Trigger the first refresh by setting the signal
        store.setSignal(counter$, 1)

        // We should have seen multiple refresh cycles:
        // 1. Initial setSignal(1) -> refresh -> callback sees 1, sets to 2
        // 2. setSignal(2) -> refresh -> callback sees 2, sets to 3
        // 3. setSignal(3) -> refresh -> callback sees 3, stops
        expect(refreshCycles).toEqual([1, 2, 3])
        expect(store.query(counter$)).toBe(3)

        unsubscribe()
      }),
    )

    /**
     * Same batch isolation guarantee as above, but for commits.
     * Committing events from within `onAfterRefresh` must trigger a separate refresh cycle.
     */
    Vitest.scopedLive('commit in onAfterRefresh triggers a NEW refresh cycle', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})

        const refreshReasons: string[] = []
        let todoCount = 0

        const unsubscribe = store[StoreInternalsSymbol].subscribeToAfterRefresh((info: AfterRefreshInfo) => {
          refreshReasons.push(info.reason._tag)

          // Create a second todo after the first commit completes
          // This must be a separate refresh cycle
          if (todoCount === 0) {
            todoCount++
            store.commit(events.todoCreated({ id: '2', text: 'Second (from callback)', completed: false }))
          }
        })

        store.commit(events.todoCreated({ id: '1', text: 'First', completed: false }))

        // Should have two separate commit refresh cycles
        expect(refreshReasons.filter((r) => r === 'commit')).toHaveLength(2)

        unsubscribe()
      }),
    )

    Vitest.scopedLive('refresh cycle count matches number of state changes, not batched together', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const a$ = signal(0, { label: 'a$' })
        const b$ = signal(0, { label: 'b$' })

        let refreshCount = 0

        const unsubscribe = store[StoreInternalsSymbol].subscribeToAfterRefresh((_info: AfterRefreshInfo) => {
          refreshCount++
        })

        // Each setSignal should trigger exactly one refresh
        store.setSignal(a$, 1)
        expect(refreshCount).toBe(1)

        store.setSignal(b$, 1)
        expect(refreshCount).toBe(2)

        store.setSignal(a$, 2)
        expect(refreshCount).toBe(3)

        unsubscribe()
      }),
    )
  })

  /**
   * These tests verify the exact ordering guarantees that external state management
   * integrations can rely on. The lifecycle order is:
   *
   *   1. `onBeforeChange` - state is still at OLD value
   *   2. Mutation applied - state now at NEW value
   *   3. Reactive effects run - subscriptions fire with NEW value
   *   4. `onAfterRefresh` - batch is closed, safe to sync to external systems
   *
   * This ordering ensures external systems can:
   * - Capture old state in `onBeforeChange` if needed for diffing
   * - Wait until `onAfterRefresh` to sync, knowing all effects have settled
   */
  Vitest.describe('batch boundary guarantees', () => {
    Vitest.scopedLive('onAfterRefresh fires after all reactive effects have run', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const source$ = signal(0, { label: 'source$' })

        const timeline: string[] = []

        // Subscribe to the source to create a reactive effect
        const unsubscribeQuery = store.subscribe(source$, (value: number) => {
          timeline.push(`effect:${value}`)
        })

        const unsubscribeAfterRefresh = store[StoreInternalsSymbol].subscribeToAfterRefresh(
          (_info: AfterRefreshInfo) => {
            timeline.push('afterRefresh')
          },
        )

        store.setSignal(source$, 42)

        // Effect should fire before afterRefresh
        expect(timeline).toEqual(['effect:0', 'effect:42', 'afterRefresh'])

        unsubscribeQuery()
        unsubscribeAfterRefresh()
      }),
    )

    Vitest.scopedLive('onBeforeChange fires before any state mutation', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const counter$ = signal(0, { label: 'counter$' })

        let valueAtBeforeChange: number | undefined

        const unsubscribe = store[StoreInternalsSymbol].subscribeToBeforeChange((event: BeforeChangeEvent) => {
          if (event._tag === 'setSignal') {
            // Query the CURRENT value before the change is applied
            valueAtBeforeChange = store.query(counter$)
          }
        })

        store.setSignal(counter$, 42)

        // The value should have been 0 when onBeforeChange fired
        expect(valueAtBeforeChange).toBe(0)
        // But now it should be 42
        expect(store.query(counter$)).toBe(42)

        unsubscribe()
      }),
    )

    Vitest.scopedLive('full lifecycle order: onBeforeChange -> mutation -> effects -> onAfterRefresh', () =>
      Effect.gen(function* () {
        const store = yield* makeTodoMvc({})
        const value$ = signal('initial', { label: 'value$' })

        const timeline: string[] = []

        const unsubscribeBeforeChange = store[StoreInternalsSymbol].subscribeToBeforeChange(
          (_event: BeforeChangeEvent) => {
            timeline.push(`before:${store.query(value$)}`)
          },
        )

        const unsubscribeQuery = store.subscribe(value$, (v: string) => {
          timeline.push(`effect:${v}`)
        })

        const unsubscribeAfterRefresh = store[StoreInternalsSymbol].subscribeToAfterRefresh(
          (_info: AfterRefreshInfo) => {
            timeline.push(`after:${store.query(value$)}`)
          },
        )

        store.setSignal(value$, 'updated')

        // Verify the order:
        // 1. before: sees old value
        // 2. effect: initial (from subscription setup)
        // 3. effect: sees new value
        // 4. after: sees new value
        expect(timeline).toEqual(['effect:initial', 'before:initial', 'effect:updated', 'after:updated'])

        unsubscribeBeforeChange()
        unsubscribeQuery()
        unsubscribeAfterRefresh()
      }),
    )
  })
})
