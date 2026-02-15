/** biome-ignore-all lint/a11y: test */
import * as LiveStore from '@livestore/livestore'
import { queryDb, signal } from '@livestore/livestore'
import { RG } from '@livestore/livestore/internal/testing-utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import * as SolidTesting from '@solidjs/testing-library'
import * as Solid from 'solid-js'
import { expect } from 'vitest'

import { events, makeTodoMvcSolid, StoreInternalsSymbol, tables } from './__tests__/fixture.tsx'

const makeVirtualContainerStyle = (containerHeight: number) => {
  return { height: `${containerHeight}px`, overflow: 'auto' } as const
}

const makeVirtualContentStyle = (itemCount: number, itemHeight: number) => {
  return { height: `${itemCount * itemHeight}px`, position: 'relative' } as const
}

const makeVirtualItemStyle = (index: number, itemHeight: number) => {
  return {
    position: 'absolute',
    top: `${index * itemHeight}px`,
    height: `${itemHeight}px`,
  } as const
}

Vitest.describe('useQuery', () => {
  Vitest.afterEach(() => {
    RG.__resetIds()
  })

  Vitest.scopedLive('simple', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

      const { result } = SolidTesting.renderHook(
        () => {
          return store.useQuery(allTodos$)
        },
        { wrapper },
      )

      expect(result()?.length).toBe(0)
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

      expect(result()?.length).toBe(1)
      expect(result()?.[0]?.text).toBe('buy milk')
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
    }),
  )

  Vitest.scopedLive('same `useQuery` hook invoked with different queries', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const todo1$ = queryDb(
        { query: `select * from todos where id = 't1'`, schema: Schema.Array(tables.todos.rowSchema) },
        { label: 'libraryTracksView1' },
      )
      const todo2$ = queryDb(
        { query: `select * from todos where id = 't2'`, schema: Schema.Array(tables.todos.rowSchema) },
        { label: 'libraryTracksView2' },
      )

      store.commit(
        events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
        events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }),
      )

      const [todoId, setTodoId] = Solid.createSignal('t1')

      const { result } = SolidTesting.renderHook(
        () => {
          const query = store.useQuery(() => (todoId() === 't1' ? todo1$ : todo2$))
          return () => query()?.[0]?.text
        },
        { wrapper },
      )

      expect(result()).toBe('buy milk')
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot(
        '1: after first render',
      )

      store.commit(events.todoUpdated({ id: 't1', text: 'buy soy milk' }))

      expect(result()).toBe('buy soy milk')
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot(
        '2: after first commit',
      )

      setTodoId('t2')

      expect(result()).toBe('buy eggs')
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot(
        '3: after forced rerender',
      )
    }),
  )

  Vitest.scopedLive('filtered dependency query', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const filter$ = signal('t1', { label: 'id-filter' })

      const todo$ = queryDb((get) => tables.todos.where('id', get(filter$)), { label: 'todo' })

      store.commit(
        events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
        events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }),
      )

      const { result } = SolidTesting.renderHook(
        () => {
          const query = store.useQuery(todo$)
          return () => query()?.[0]?.text
        },
        { wrapper },
      )

      expect(result()).toBe('buy milk')

      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      store.commit(events.todoUpdated({ id: 't1', text: 'buy soy milk' }))

      expect(result()).toBe('buy soy milk')
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

      store.setSignal(filter$, 't2')

      expect(result()).toBe('buy eggs')
      expect(store[StoreInternalsSymbol].reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
    }),
  )

  Vitest.scopedLive('should work for a dynamic list with query swapping', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const ListItem = (props: { id: number }) => {
        const res = store.useQuery(() =>
          LiveStore.computed(() => props.id, { label: `ListItem.${props.id}`, deps: props.id }),
        )
        return <div role="listitem">{String(res())}</div>
      }

      const [numItems, setNumItems] = Solid.createSignal(1)

      const ListWrapper = () => {
        return (
          <div>
            <Solid.For each={Array.from({ length: numItems() }, (_, i) => i).toReversed()}>
              {(id) => <ListItem id={id} />}
            </Solid.For>
          </div>
        )
      }

      const { container } = SolidTesting.render(() => <ListWrapper />, { wrapper })

      expect(container.textContent).toBe('0')

      setNumItems(3)

      expect(container.textContent).toBe('210')
    }),
  )

  // NOTE: This test covers special Solid lifecycle patterns similar to react-window
  // It causes query swapping in reactive computations and cleanup calls
  // This tests the `_tag: 'destroyed'` state in the `spanAlreadyStartedCache`
  Vitest.scopedLive('should work for a virtualized list with @solid-primitives/virtual', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      // Create a signal to control the number of items
      const [numItems, setNumItems] = Solid.createSignal(1)

      const VirtualizedList = () => {
        const itemData = Solid.createMemo(() => Array.from({ length: numItems() }, (_, i) => i).reverse())

        const containerHeight = 100
        const itemHeight = 10
        const visibleCount = Math.ceil(containerHeight / itemHeight)
        const containerStyle = makeVirtualContainerStyle(containerHeight)
        const contentStyle = Solid.createMemo(() => makeVirtualContentStyle(itemData().length, itemHeight))

        return (
          <div style={containerStyle}>
            <div style={contentStyle()}>
              <Solid.For each={itemData().slice(0, visibleCount + 1)}>
                {(id, index) => <VirtualListItem id={id} index={index()} itemHeight={itemHeight} />}
              </Solid.For>
            </div>
          </div>
        )
      }

      const VirtualListItem = (props: { id: number; index: number; itemHeight: number }) => {
        const res = store.useQuery(() =>
          LiveStore.computed(() => props.id, { label: `VirtualListItem.${props.id}`, deps: props.id }),
        )
        const style = makeVirtualItemStyle(props.index, props.itemHeight)
        return (
          <div role="listitem" style={style}>
            {res()}
          </div>
        )
      }

      const { container } = SolidTesting.render(() => <VirtualizedList />, { wrapper })

      expect(container.textContent?.trim()).toBe('0')

      // Test virtualized list update - this causes query swapping similar to react-window
      setNumItems(3)

      // In Solid, reactivity is synchronous, so we don't need to wait
      expect(container.textContent?.replace(/\s+/g, '')).toBe('210')
    }),
  )

  Vitest.scopedLive('should work with signal', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})
      const num$ = signal(0)

      const { result } = SolidTesting.renderHook(() => store.useQuery(num$), { wrapper })

      expect(result()).toBe(0)

      store.setSignal(num$, 1)

      expect(result()).toBe(1)
    }),
  )

  Vitest.scopedLive('supports query builders directly', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      store.commit(
        events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
        events.todoCreated({ id: 't2', text: 'buy eggs', completed: true }),
      )

      const todosWhereIncomplete = tables.todos.where({ completed: false })

      const { result } = SolidTesting.renderHook(
        () => {
          const todos = store.useQuery(todosWhereIncomplete)
          return () => todos()?.map((todo) => todo.id)
        },
        { wrapper },
      )

      expect(result()).toEqual(['t1'])
    }),
  )

  Vitest.scopedLive('union of different result types with useQuery', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const str$ = signal('hello', { label: 'str' })
      const num$ = signal(123, { label: 'num' })

      const [useNum, setUseNum] = Solid.createSignal(false)

      const { result } = SolidTesting.renderHook(
        () => {
          const query$ = Solid.createMemo(() => (useNum() ? num$ : str$))
          return store.useQuery(query$)
        },
        { wrapper },
      )

      expect(result()).toBe('hello')

      setUseNum(true)

      expect(result()).toBe(123)
    }),
  )
})
