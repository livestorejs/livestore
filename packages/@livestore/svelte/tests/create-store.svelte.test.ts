import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { Events, makeSchema, State } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import { queryDb, signal } from '@livestore/livestore'
import { Schema } from '@livestore/utils/effect'
import * as svelteTestingLibrary from '@testing-library/svelte'
import * as svelte from 'svelte'
import * as vitest from 'vitest'
import { describe, it } from 'vitest'

import { createStore } from '../src/create-store.svelte.ts'
import Harness from './__fixtures__/Harness.svelte'
import { renderQueryHarness, renderRerunHarness, renderSwappableHarness, waitForLastSnapshot } from './harness.ts'

// TODO add coverage for:
// - subscription leak guard on double-dispose scenarios

describe('createStore (svelte)', () => {
  vitest.afterEach(() => {
    vitest.vi.restoreAllMocks()
  })

  it('re-runs tracked effects when query results change', async () => {
    const store = await makeStore()
    const allTodos$ = makeAllTodosQuery()

    const { snapshots, unmount } = renderQueryHarness(store, allTodos$)
    await waitForLastSnapshot(snapshots, [])

    store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))
    await waitForLastSnapshot(snapshots, [
      {
        completed: false,
        id: 't1',
        text: 'buy milk',
      },
    ] as const)

    store.commit(events.todoRenamed({ id: 't1', text: 'buy oat milk' }))
    await waitForLastSnapshot(snapshots, [
      {
        completed: false,
        id: 't1',
        text: 'buy oat milk',
      },
    ] as const)

    unmount()
  })

  it('cleans up subscriptions when the effect is disposed', async () => {
    const store = await makeStore()
    const allTodos$ = makeAllTodosQuery()

    const unsubscribeSpy = vitest.vi.fn()
    const originalSubscribe = store.subscribe.bind(store)

    store.subscribe = ((query, onUpdateOrOptions, maybeOptions) => {
      if (typeof onUpdateOrOptions === 'function') {
        const teardown = originalSubscribe(query, onUpdateOrOptions, maybeOptions)
        return () => {
          unsubscribeSpy()
          teardown()
        }
      }

      return originalSubscribe(query, onUpdateOrOptions)
    }) as typeof store.subscribe

    const { unmount } = renderQueryHarness(store, allTodos$)
    await svelte.tick()

    unmount()
    await svelte.tick()

    store.commit(events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }))
    await svelte.tick()

    vitest.expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('propagates effect cleanup on reruns', async () => {
    const store = await makeStore()
    const allTodos$ = makeAllTodosQuery()

    const unsubscribeSpy = vitest.vi.fn()
    const originalSubscribe = store.subscribe.bind(store)

    store.subscribe = ((query, onUpdateOrOptions, maybeOptions) => {
      if (typeof onUpdateOrOptions === 'function') {
        const teardown = originalSubscribe(query, onUpdateOrOptions, maybeOptions)
        return () => {
          unsubscribeSpy()
          teardown()
        }
      }

      return originalSubscribe(query, onUpdateOrOptions)
    }) as typeof store.subscribe

    const { updateDep, unmount } = renderRerunHarness(store, allTodos$)
    await svelte.tick()

    updateDep('first-rerun')
    await svelte.tick()

    updateDep('second-rerun')
    await svelte.tick()

    unmount()
    await svelte.tick()

    // one cleanup per rerun plus final unmount
    vitest.expect(unsubscribeSpy).toHaveBeenCalledTimes(3)
  })

  it('cleans up subscriptions on query swaps and disposal', async () => {
    const store = await makeStore()
    const todosByCompletedFalse$ = makeTodosByCompletedQuery(false)
    const todosByCompletedTrue$ = makeTodosByCompletedQuery(true)

    const unsubscribeSpy = vitest.vi.fn()
    const originalSubscribe = store.subscribe.bind(store)

    store.subscribe = ((query, onUpdateOrOptions, maybeOptions) => {
      if (typeof onUpdateOrOptions === 'function') {
        const teardown = originalSubscribe(query, onUpdateOrOptions, maybeOptions)
        return () => {
          unsubscribeSpy()
          teardown()
        }
      }

      return originalSubscribe(query, onUpdateOrOptions)
    }) as typeof store.subscribe

    const { updateQuery, unmount } = renderSwappableHarness(store, todosByCompletedFalse$)
    await svelte.tick()

    updateQuery(todosByCompletedTrue$)
    await svelte.tick()

    unmount()
    await svelte.tick()

    store.commit(events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }))
    await svelte.tick()

    // once for the swap, once for the final unmount
    vitest.expect(unsubscribeSpy).toHaveBeenCalledTimes(2)
  })

  it('swaps tracked queries and cleans up old tokens', async () => {
    const store = await makeStore()
    const todosByCompletedFalse$ = makeTodosByCompletedQuery(false)
    const todosByCompletedTrue$ = makeTodosByCompletedQuery(true)

    const { snapshots, updateQuery, unmount } = renderSwappableHarness(store, todosByCompletedFalse$)

    await waitForLastSnapshot(snapshots, [])

    store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))
    await waitForLastSnapshot(snapshots, [{ completed: false, id: 't1', text: 'buy milk' }])

    // Swap the query to a different token/value; the old token should be cleaned up
    updateQuery(todosByCompletedTrue$)
    await svelte.tick()

    store.commit(events.todoRenamed({ id: 't1', text: 'buy oat milk' }))
    await waitForLastSnapshot(snapshots, [])

    store.commit(events.todoCreated({ id: 't2', text: 'done', completed: true }))
    await waitForLastSnapshot(snapshots, [{ completed: true, id: 't2', text: 'done' }])

    unmount()
  })

  it('supports swapping between queryables with different result types', async () => {
    const store = await makeStore()
    const str$ = signal<string | number>('hello', { label: 'str' })
    const num$ = signal<string | number>(123, { label: 'num' })

    const { snapshots, updateQuery, unmount } = renderSwappableHarness(store, str$)

    await waitForLastSnapshot(snapshots, 'hello')

    updateQuery(num$)
    await waitForLastSnapshot(snapshots, 123)

    unmount()
  })

  it('reacts to signal-driven queryables', async () => {
    const store = await makeStore()
    const filter$ = signal('t1', { label: 'id-filter' })
    const todoById$ = queryDb((get) => todos.where({ id: get(filter$) }), { label: 'todo-by-id' })

    store.commit(
      events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
      events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }),
    )

    const { snapshots, unmount } = renderQueryHarness(store, todoById$)
    await waitForLastSnapshot(snapshots, [
      {
        completed: false,
        id: 't1',
        text: 'buy milk',
      },
    ])

    store.commit(events.todoRenamed({ id: 't1', text: 'buy oat milk' }))
    await waitForLastSnapshot(snapshots, [
      {
        completed: false,
        id: 't1',
        text: 'buy oat milk',
      },
    ])

    store.setSignal(filter$, 't2')

    await waitForLastSnapshot(snapshots, [
      {
        completed: false,
        id: 't2',
        text: 'buy eggs',
      },
    ])

    unmount()
  })

  it('aborts the createStore signal on teardown', async () => {
    const originalGetAbortSignal = svelte.getAbortSignal
    const getAbortSignalSpy = vitest.vi.spyOn(svelte, 'getAbortSignal').mockImplementation(() => {
      const signal = originalGetAbortSignal()
      capturedSignal = signal
      return signal
    })

    let capturedSignal: AbortSignal | undefined

    const { unmount } = svelteTestingLibrary.render(Harness, {
      props: {
        mode: 'createStore',
        options: {
          adapter: makeInMemoryAdapter(),
          schema,
          storeId: 'default',
          debug: { instanceId: 'test-abort' },
        },
        onCreated: vitest.vi.fn(),
      },
    })

    await svelteTestingLibrary.waitFor(() => {
      vitest.expect(capturedSignal?.aborted).toBe(false)
    })

    unmount()

    await svelteTestingLibrary.waitFor(() => {
      vitest.expect(capturedSignal?.aborted).toBe(true)
    })
    getAbortSignalSpy.mockRestore()
  })
})

const todos = State.SQLite.table({
  name: 'todos',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    text: State.SQLite.text({ default: '' }),
    completed: State.SQLite.boolean({ default: false }),
  },
})

const events = {
  todoCreated: Events.synced({
    name: 'todoCreated',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String, completed: Schema.Boolean }),
  }),
  todoRenamed: Events.synced({
    name: 'todoRenamed',
    schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  todoCreated: ({ id, text, completed }) => todos.insert({ id, text, completed }),
  todoRenamed: ({ id, text }) => todos.update({ text }).where({ id }),
})

const schema = makeSchema({ state: State.SQLite.makeState({ tables: { todos }, materializers }), events })

const makeStore = async (): Promise<Store<typeof schema>> =>
  createStore({
    adapter: makeInMemoryAdapter(),
    schema,
    storeId: 'default',
    debug: { instanceId: 'test' },
  })

const makeAllTodosQuery = () => queryDb(todos, { label: 'all-todos' })

const makeTodosByCompletedQuery = (completed: boolean) =>
  queryDb(todos.where({ completed }), { label: completed ? 'completed-true' : 'completed-false' })
