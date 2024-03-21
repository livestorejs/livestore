import { act, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { makeTodoMvc, parseTodos } from '../__tests__/react/fixture.js'
import { querySQL } from '../reactiveQueries/sql.js'
import * as LiveStoreReact from './index.js'

describe('useQuery', () => {
  it('simple', async () => {
    const { wrapper, store, cud, makeRenderCount } = await makeTodoMvc()

    const renderCount = makeRenderCount()

    const allTodos$ = querySQL(`select * from todos`, { map: parseTodos })

    const { result } = renderHook(
      () => {
        renderCount.inc()

        return LiveStoreReact.useQuery(allTodos$)
      },
      { wrapper },
    )

    expect(result.current.length).toBe(0)
    expect(renderCount.val).toBe(1)

    act(() => store.mutate(cud.todos.insert({ id: 't1', text: 'buy milk', completed: false })))

    expect(result.current.length).toBe(1)
    expect(result.current[0]!.text).toBe('buy milk')
    expect(renderCount.val).toBe(2)
  })

  it('same `useQuery` hook invoked with different queries', async () => {
    const { wrapper, store, cud, makeRenderCount } = await makeTodoMvc()

    const renderCount = makeRenderCount()

    const todo1$ = querySQL(`select * from todos where id = 't1'`, { label: 'libraryTracksView1', map: parseTodos })
    const todo2$ = querySQL(`select * from todos where id = 't2'`, { label: 'libraryTracksView2', map: parseTodos })

    store.mutate(
      cud.todos.insert({ id: 't1', text: 'buy milk', completed: false }),
      cud.todos.insert({ id: 't2', text: 'buy eggs', completed: false }),
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

    act(() => store.mutate(cud.todos.update({ where: { id: 't1' }, values: { text: 'buy soy milk' } })))

    expect(result.current).toBe('buy soy milk')
    expect(renderCount.val).toBe(2)

    rerender('t2')

    expect(result.current).toBe('buy eggs')
    expect(renderCount.val).toBe(3)
  })
})
