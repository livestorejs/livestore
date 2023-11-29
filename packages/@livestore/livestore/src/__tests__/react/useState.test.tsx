import { act, render, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import * as LiveStore from '../../index.js'
import * as LiveStoreReact from '../../react/index.js'
import type { Todo } from './fixture.js'
import { makeTodoMvc } from './fixture.js'

describe('useState', () => {
  it('should update the data based on component key', async () => {
    let renderCount = 0

    const { wrapper, AppComponentSchema, store } = await makeTodoMvc()

    const { result, rerender } = renderHook(
      (userId: string) => {
        renderCount++

        const [state, setState] = LiveStoreReact.useState(AppComponentSchema, userId)
        return { state, setState }
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount).toBe(1)

    act(() => {
      void store.execute(LiveStore.sql`INSERT INTO state__UserInfo (id, username) VALUES ('u2', 'username_u2');`)
    })

    rerender('u2')

    expect(result.current.state.id).toBe('u2')
    expect(result.current.state.username).toBe('username_u2')
    expect(renderCount).toBe(2)
  })

  it('should update the data reactively - via setState', async () => {
    let renderCount = 0

    const { wrapper, AppComponentSchema } = await makeTodoMvc()

    const { result } = renderHook(
      (userId: string) => {
        renderCount++

        const [state, setState] = LiveStoreReact.useState(AppComponentSchema, userId)
        return { state, setState }
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount).toBe(1)

    act(() => result.current.setState.username('username_u1_hello'))

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('username_u1_hello')
    expect(renderCount).toBe(2)
  })

  it('should update the data reactively - via raw store update', async () => {
    let renderCount = 0

    const { wrapper, AppComponentSchema, store } = await makeTodoMvc()

    const { result } = renderHook(
      (userId: string) => {
        renderCount++

        const [state, setState] = LiveStoreReact.useState(AppComponentSchema, userId)
        return { state, setState }
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount).toBe(1)

    act(() => result.current.setState.username('username_u1_hello'))

    act(() => {
      void store.execute(LiveStore.sql`UPDATE state__UserInfo SET username = 'username_u1_hello' WHERE id = 'u1';`)
    })

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('username_u1_hello')
    expect(renderCount).toBe(2)
  })

  it('should work for a larger app', async () => {
    const allTodos$ = LiveStore.querySQL<Todo>(`select * from todos`, { label: 'allTodos' })

    const { wrapper, store } = await makeTodoMvc()

    const AppRouterSchema = LiveStore.defineStateTable('AppRouter', {
      currentTaskId: LiveStore.DbSchema.text({ default: null, nullable: true }),
    })

    let appRouterRenderCount = 0
    let globalSetState: LiveStoreReact.StateSetters<typeof AppRouterSchema> | undefined
    const AppRouter: React.FC = () => {
      appRouterRenderCount++

      const [state, setState] = LiveStoreReact.useState(AppRouterSchema)

      globalSetState = setState

      return (
        <div>
          <TasksList setTaskId={setState.currentTaskId} />
          <div role="current-id">Current Task Id: {state.currentTaskId ?? '-'}</div>
          {state.currentTaskId ? <TaskDetails id={state.currentTaskId} /> : <div>Click on a task to see details</div>}
        </div>
      )
    }

    const TasksList: React.FC<{ setTaskId: (_: string) => void }> = ({ setTaskId }) => {
      const allTodos = LiveStoreReact.useQuery(allTodos$)

      return (
        <div>
          {allTodos.map((_) => (
            <div key={_.id} onClick={() => setTaskId(_.id)}>
              {_.id}
            </div>
          ))}
        </div>
      )
    }

    const TaskDetails: React.FC<{ id: string }> = ({ id }) => {
      const todo = LiveStoreReact.useTemporaryQuery(() =>
        LiveStore.querySQL<Todo>(`select * from todos where id = '${id}' limit 1`).getFirstRow(),
      )
      return <div role="content">{JSON.stringify(todo)}</div>
    }

    const renderResult = render(<AppRouter />, { wrapper })

    expect(appRouterRenderCount).toBe(1)

    act(() =>
      store.applyEvent('livestore.RawSql', {
        sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0);`,
        writeTables: ['todos'],
      }),
    )

    expect(appRouterRenderCount).toBe(1)
    expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: -"')

    act(() => globalSetState!.currentTaskId('t1'))

    expect(appRouterRenderCount).toBe(2)
    expect(renderResult.getByRole('content').innerHTML).toMatchInlineSnapshot(
      '"{\\"id\\":\\"t1\\",\\"text\\":\\"buy milk\\",\\"completed\\":0}"',
    )

    expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t1"')

    act(() =>
      store.applyEvents([
        {
          eventType: 'livestore.RawSql',
          args: {
            sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t2', 'buy eggs', 0);`,
            writeTables: ['todos'],
          },
        },
        {
          eventType: 'livestore.UpdateComponentState',
          args: {
            id: 'singleton',
            columnNames: ['currentTaskId'],
            tableName: AppRouterSchema.schema.name,
            bindValues: { currentTaskId: 't2' },
          },
        },
        {
          eventType: 'livestore.RawSql',
          args: {
            sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t3', 'buy bread', 0);`,
            writeTables: ['todos'],
          },
        },
      ]),
    )

    expect(appRouterRenderCount).toBe(3)
    expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t2"')
  })
})

// TODO add otel tests
