import { act, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import * as LiveStoreReact from '../../react/index.js'
import { querySQL } from '../../reactiveQueries/sql.js'
import { sql } from '../../util.js'
import type { Todo } from './fixture.js'
import { makeTodoMvc } from './fixture.js'

describe('useQuery', () => {
  it('simple', async () => {
    let renderCount = 0

    const { wrapper, store } = await makeTodoMvc()

    const allTodos$ = querySQL<Todo>(`select * from todos`)

    const { result } = renderHook(
      () => {
        renderCount++

        return LiveStoreReact.useQuery(allTodos$)
      },
      { wrapper },
    )

    expect(result.current.length).toBe(0)
    expect(renderCount).toBe(1)

    act(() =>
      store.applyEvent('RawSql', {
        sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
        writeTables: ['todos'],
      }),
    )

    expect(result.current.length).toBe(1)
    expect(result.current[0]!.text).toBe('buy milk')
    expect(renderCount).toBe(2)
  })

  it('same `useQuery` hook invoked with different queries', async () => {
    let renderCount = 0

    const { wrapper, store } = await makeTodoMvc()

    const todo1$ = querySQL<Todo>(`select * from todos where id = 't1'`, { label: 'libraryTracksView1' })
    const todo2$ = querySQL<Todo>(`select * from todos where id = 't2'`, { label: 'libraryTracksView2' })

    store.applyEvent('RawSql', {
      sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
      writeTables: ['todos'],
    })

    store.applyEvent('RawSql', {
      sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t2', 'buy eggs', 0)`,
      writeTables: ['todos'],
    })

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

    act(() =>
      store.applyEvent('RawSql', {
        sql: sql`UPDATE todos SET text = 'buy soy milk' WHERE id = 't1'`,
        writeTables: ['todos'],
      }),
    )

    expect(result.current).toBe('buy soy milk')
    expect(renderCount).toBe(2)

    rerender('t2')

    expect(result.current).toBe('buy eggs')
    expect(renderCount).toBe(3)
  })
})
