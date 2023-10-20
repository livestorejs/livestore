import { makeNoopTracer } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import { act, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import * as LiveStoreReact from '../../react/index.js'
import { LiveStoreSQLQuery } from '../../reactiveQueries/sql.js'
import { sql } from '../../util.js'
import type { Todo } from './fixture.js'
import { makeTodoMvc } from './fixture.js'

const query = new LiveStoreSQLQuery<Todo>({
  label: 'todo',
  otelContext: otel.context.active(),
  otelTracer: makeNoopTracer(),
  payload: {
    genQueryString: `select * from todos`,
    queriedTables: ['todos'],
  },
})

describe('useQuery', () => {
  it('todo', async () => {
    let renderCount = 0

    const { wrapper, AppSchema, store } = await makeTodoMvc()

    const { result, rerender } = renderHook(
      () => {
        renderCount++

        // const query = React.useMemo(
        //   () =>
        //     new LiveStoreSQLQuery<Todo>({
        //       label: 'todo',
        //       otelContext: otel.context.active(),
        //       otelTracer: makeNoopTracer(),
        //       payload: {
        //         genQueryString: `select * from todos`,
        //         queriedTables: ['todos'],
        //       },
        //     }),
        //   [],
        // )

        return LiveStoreReact.useQuery(query)
      },
      { wrapper },
    )

    console.log('result.current', result.current)

    expect(result.current.length).toBe(0)
    expect(renderCount).toBe(1)

    act(() =>
      store.applyEvent('RawSql', {
        sql: sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);`,
        bindValues: {},
        writeTables: ['todos'],
      }),
    )

    expect(result.current.length).toBe(1)
    expect(result.current[0]!.text).toBe('buy milk')
    expect(renderCount).toBe(2)
  })
})
