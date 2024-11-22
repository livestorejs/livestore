import { queryDb } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { makeTodoMvcReact, tables, todos } from './__tests__/fixture.js'
import * as LiveStoreReact from './mod.js'

describe('useQuery', () => {
  it('simple', () =>
    Effect.gen(function* () {
      const { wrapper, store, makeRenderCount } = yield* makeTodoMvcReact()

      const renderCount = makeRenderCount()

      const allTodos$ = queryDb({ query: `select * from todos`, schema: Schema.Array(tables.todos.schema) })

      const { result } = renderHook(
        () => {
          renderCount.inc()

          return LiveStoreReact.useQuery(allTodos$)
        },
        { wrapper },
      )

      expect(result.current.length).toBe(0)
      expect(renderCount.val).toBe(1)

      React.act(() => store.mutate(todos.insert({ id: 't1', text: 'buy milk', completed: false })))

      expect(result.current.length).toBe(1)
      expect(result.current[0]!.text).toBe('buy milk')
      expect(renderCount.val).toBe(2)
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  it('same `useQuery` hook invoked with different queries', () =>
    Effect.gen(function* () {
      const { wrapper, store, makeRenderCount } = yield* makeTodoMvcReact()

      const renderCount = makeRenderCount()

      const todo1$ = queryDb(
        { query: `select * from todos where id = 't1'`, schema: Schema.Array(tables.todos.schema) },
        { label: 'libraryTracksView1' },
      )
      const todo2$ = queryDb(
        { query: `select * from todos where id = 't2'`, schema: Schema.Array(tables.todos.schema) },
        { label: 'libraryTracksView2' },
      )

      store.mutate(
        todos.insert({ id: 't1', text: 'buy milk', completed: false }),
        todos.insert({ id: 't2', text: 'buy eggs', completed: false }),
      )

      const { result, rerender } = renderHook(
        (todoId: string) => {
          renderCount.inc()

          const query$ = React.useMemo(() => (todoId === 't1' ? todo1$ : todo2$), [todoId])

          return LiveStoreReact.useQuery(query$)[0]!.text
        },
        { wrapper, initialProps: 't1' },
      )

      expect(result.current).toBe('buy milk')
      expect(renderCount.val).toBe(1)

      React.act(() => store.mutate(todos.update({ where: { id: 't1' }, values: { text: 'buy soy milk' } })))

      expect(result.current).toBe('buy soy milk')
      expect(renderCount.val).toBe(2)

      rerender('t2')

      expect(result.current).toBe('buy eggs')
      expect(renderCount.val).toBe(3)
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))
})
