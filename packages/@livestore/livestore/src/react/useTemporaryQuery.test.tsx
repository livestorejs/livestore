import { Schema } from '@livestore/utils/effect'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { makeTodoMvc, tables, todos } from '../__tests__/react/fixture.js'
import type * as LiveStore from '../index.js'
import { querySQL } from '../reactiveQueries/sql.js'
import * as LiveStoreReact from './index.js'

describe('useTemporaryQuery', () => {
  it('simple', async () => {
    const { wrapper, store, makeRenderCount } = await makeTodoMvc()

    const renderCount = makeRenderCount()

    store.mutate(
      todos.insert({ id: 't1', text: 'buy milk', completed: false }),
      todos.insert({ id: 't2', text: 'buy bread', completed: false }),
    )

    const queryMap = new Map<string, LiveStore.LiveQuery<any>>()

    const { rerender, result, unmount } = renderHook(
      (id: string) => {
        renderCount.inc()

        return LiveStoreReact.useTemporaryQuery(() => {
          const query$ = querySQL(`select * from todos where id = '${id}'`, {
            schema: Schema.Array(tables.todos.schema),
          })
          queryMap.set(id, query$)
          return query$
        }, id)
      },
      { wrapper, initialProps: 't1' },
    )

    expect(result.current.length).toBe(1)
    expect(result.current[0]!.text).toBe('buy milk')
    expect(renderCount.val).toBe(1)
    expect(queryMap.get('t1')!.runs).toBe(1)

    rerender('t2')

    expect(result.current.length).toBe(1)
    expect(result.current[0]!.text).toBe('buy bread')
    expect(renderCount.val).toBe(2)
    expect(queryMap.get('t1')!.runs).toBe(1)
    expect(queryMap.get('t2')!.runs).toBe(1)

    unmount()

    expect(queryMap.get('t2')!.runs).toBe(1)
  })
})
