import { act, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import * as LiveStoreReact from '../../react/index.js'
import { querySQL } from '../../reactiveQueries/sql.js'
import { makeTodoMvc, parseTodos } from './fixture.js'

describe('useQuery', () => {
  it('simple', async () => {
    let renderCount = 0

    const { wrapper, store, mutations } = await makeTodoMvc()

    const allTodos$ = querySQL(`select * from todos`, { map: parseTodos })

    const { result } = renderHook(
      () => {
        renderCount++

        return LiveStoreReact.useQuery(allTodos$)
      },
      { wrapper },
    )

    expect(result.current.length).toBe(0)
    expect(renderCount).toBe(1)

    act(() => store.mutate(mutations.todos.insert({ id: 't1', text: 'buy milk', completed: false })))

    expect(result.current.length).toBe(1)
    expect(result.current[0]!.text).toBe('buy milk')
    expect(renderCount).toBe(2)
  })

  it('same `useQuery` hook invoked with different queries', async () => {
    let renderCount = 0

    const { wrapper, store, mutations } = await makeTodoMvc()

    const todo1$ = querySQL(`select * from todos where id = 't1'`, { label: 'libraryTracksView1', map: parseTodos })
    const todo2$ = querySQL(`select * from todos where id = 't2'`, { label: 'libraryTracksView2', map: parseTodos })

    store.mutate(
      mutations.todos.insert({ id: 't1', text: 'buy milk', completed: false }),
      mutations.todos.insert({ id: 't2', text: 'buy eggs', completed: false }),
    )

    const { result, rerender } = renderHook(
      (todoId: string) => {
        renderCount++

        const query$ = React.useMemo(() => (todoId === 't1' ? todo1$ : todo2$), [todoId])

        return LiveStoreReact.useQuery(query$)[0]!.text
      },
      { wrapper, initialProps: 't1' },
    )

    expect(result.current).toBe('buy milk')
    expect(renderCount).toBe(1)

    act(() => store.mutate(mutations.todos.update({ where: { id: 't1' }, values: { text: 'buy soy milk' } })))

    expect(result.current).toBe('buy soy milk')
    expect(renderCount).toBe(2)

    rerender('t2')

    expect(result.current).toBe('buy eggs')
    expect(renderCount).toBe(3)
  })
})
