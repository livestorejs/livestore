import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { sql } from '../../index.js'
import * as LiveStoreReact from '../../react/index.js'
import { makeTodoMvc } from './fixture.js'

describe('useComponentState', () => {
  it('should update the data based on component key', async () => {
    let renderCount = 0

    const { wrapper, AppSchema, store } = await makeTodoMvc()

    const { result, rerender } = renderHook(
      (userId: string) => {
        renderCount++

        return LiveStoreReact.useComponentState({
          schema: AppSchema,
          componentKey: { name: 'UserInfo', id: userId },
        })
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount).toBe(1)

    act(() => {
      void store.execute(sql`INSERT INTO components__UserInfo (id, username) VALUES ('u2', 'username_u2');`)
    })

    rerender('u2')

    expect(result.current.state.id).toBe('u2')
    expect(result.current.state.username).toBe('username_u2')
    expect(renderCount).toBe(2)
  })

  it('should update the data reactively - via setState', async () => {
    let renderCount = 0

    const { wrapper, AppSchema } = await makeTodoMvc()

    const { result } = renderHook(
      (userId: string) => {
        renderCount++

        return LiveStoreReact.useComponentState({
          schema: AppSchema,
          componentKey: { name: 'UserInfo', id: userId },
        })
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

    const { wrapper, AppSchema, store } = await makeTodoMvc()

    const { result } = renderHook(
      (userId: string) => {
        renderCount++

        return LiveStoreReact.useComponentState({
          schema: AppSchema,
          componentKey: { name: 'UserInfo', id: userId },
        })
      },
      { wrapper, initialProps: 'u1' },
    )

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('')
    expect(renderCount).toBe(1)

    act(() => result.current.setState.username('username_u1_hello'))

    act(() => {
      void store.execute(sql`UPDATE components__UserInfo SET username = 'username_u1_hello' WHERE id = 'u1';`)
    })

    expect(result.current.state.id).toBe('u1')
    expect(result.current.state.username).toBe('username_u1_hello')
    expect(renderCount).toBe(2)
  })
})
