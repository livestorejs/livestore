import '@livestore/utils-dev/node-vitest-polyfill'

import { makeRef, queryDb } from '@livestore/livestore'
import * as LiveStore from '@livestore/livestore'
import { RG } from '@livestore/livestore/internal/testing-utils'
import { Effect, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import * as ReactTesting from '@testing-library/react'
import React from 'react'
// @ts-expect-error no types
import * as ReactWindow from 'react-window'
import { expect } from 'vitest'

import { events, makeTodoMvcReact, tables } from './__tests__/fixture.js'
import { __resetUseRcResourceCache } from './useRcResource.js'

Vitest.describe.each([{ strictMode: true }, { strictMode: false }] as const)(
  'useQuery (strictMode=%s)',
  ({ strictMode }) => {
    Vitest.afterEach(() => {
      RG.__resetIds()
      __resetUseRcResourceCache()
    })

    Vitest.scopedLive('simple', () =>
      Effect.gen(function* () {
        const { wrapper, store, renderCount } = yield* makeTodoMvcReact({ strictMode })

        const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) })

        const { result } = ReactTesting.renderHook(
          () => {
            renderCount.inc()

            return store.useQuery(allTodos$)
          },
          { wrapper },
        )

        expect(result.current.length).toBe(0)
        expect(renderCount.val).toBe(1)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

        ReactTesting.act(() => store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false })))

        expect(result.current.length).toBe(1)
        expect(result.current[0]!.text).toBe('buy milk')
        expect(renderCount.val).toBe(2)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
      }),
    )

    Vitest.scopedLive('same `useQuery` hook invoked with different queries', () =>
      Effect.gen(function* () {
        const { wrapper, store, renderCount } = yield* makeTodoMvcReact({ strictMode })

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

        const { result, rerender } = ReactTesting.renderHook(
          (todoId: string) => {
            renderCount.inc()

            const query$ = React.useMemo(() => (todoId === 't1' ? todo1$ : todo2$), [todoId])

            return store.useQuery(query$)[0]!.text
          },
          { wrapper, initialProps: 't1' },
        )

        expect(result.current).toBe('buy milk')
        expect(renderCount.val).toBe(1)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot('1: after first render')

        ReactTesting.act(() => store.commit(events.todoUpdated({ id: 't1', text: 'buy soy milk' })))

        expect(result.current).toBe('buy soy milk')
        expect(renderCount.val).toBe(2)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot('2: after first commit')

        rerender('t2')

        expect(result.current).toBe('buy eggs')
        expect(renderCount.val).toBe(3)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot('3: after forced rerender')
      }),
    )

    Vitest.scopedLive('filtered dependency query', () =>
      Effect.gen(function* () {
        const { wrapper, store, renderCount } = yield* makeTodoMvcReact({ strictMode })

        const filter$ = makeRef('t1', { label: 'id-filter' })

        const todo$ = queryDb((get) => tables.todos.where('id', get(filter$)), { label: 'todo' })

        store.commit(
          events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
          events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }),
        )

        const { result } = ReactTesting.renderHook(
          () => {
            renderCount.inc()

            return store.useQuery(todo$)[0]!.text
          },
          { wrapper },
        )

        expect(result.current).toBe('buy milk')
        expect(renderCount.val).toBe(1)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

        ReactTesting.act(() => store.commit(events.todoUpdated({ id: 't1', text: 'buy soy milk' })))

        expect(result.current).toBe('buy soy milk')
        expect(renderCount.val).toBe(2)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()

        ReactTesting.act(() => store.setRef(filter$, 't2'))

        expect(result.current).toBe('buy eggs')
        expect(renderCount.val).toBe(3)
        expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
      }),
    )

    // NOTE this test covers some special react lifecyle paths which I couldn't easily reproduce without react-window
    // it basically causes a "query swap" in the `useMemo` and both a `useEffect` cleanup call.
    // To handle this properly we introduced the `_tag: 'destroyed'` state in the `spanAlreadyStartedCache`.
    Vitest.scopedLive('should work for a list with react-window', () =>
      Effect.gen(function* () {
        const { wrapper, store } = yield* makeTodoMvcReact({ strictMode })

        const ListWrapper: React.FC<{ numItems: number }> = ({ numItems }) => {
          return (
            <ReactWindow.FixedSizeList
              height={100}
              width={100}
              itemSize={10}
              itemCount={numItems}
              itemData={Array.from({ length: numItems }, (_, i) => i).reverse()}
            >
              {ListItem}
            </ReactWindow.FixedSizeList>
          )
        }

        const ListItem: React.FC<{ data: ReadonlyArray<number>; index: number }> = ({ data: ids, index }) => {
          const id = ids[index]!
          const res = store.useQuery(LiveStore.computed(() => id, { label: `ListItem.${id}`, deps: id }))
          return <div role="listitem">{res}</div>
        }

        const renderResult = ReactTesting.render(<ListWrapper numItems={1} />, { wrapper })

        expect(renderResult.container.textContent).toBe('0')

        renderResult.rerender(<ListWrapper numItems={2} />)

        expect(renderResult.container.textContent).toBe('10')
      }),
    )
  },
)
