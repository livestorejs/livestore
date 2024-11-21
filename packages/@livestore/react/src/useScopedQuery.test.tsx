import * as LiveStore from '@livestore/livestore'
import { queryDb } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { render, renderHook } from '@testing-library/react'
import React from 'react'
// @ts-expect-error no types
import * as ReactWindow from 'react-window'
import { describe, expect, it } from 'vitest'

import { makeTodoMvcReact, tables, todos } from './__tests__/fixture.js'
import * as LiveStoreReact from './mod.js'

describe('useScopedQuery', () => {
  it('simple', () =>
    Effect.gen(function* () {
      const { wrapper, store, makeRenderCount } = yield* makeTodoMvcReact()

      const renderCount = makeRenderCount()

      store.mutate(
        todos.insert({ id: 't1', text: 'buy milk', completed: false }),
        todos.insert({ id: 't2', text: 'buy bread', completed: false }),
      )

      const queryMap = new Map<string, LiveStore.LiveQuery<any>>()

      const { rerender, result, unmount } = renderHook(
        (id: string) => {
          renderCount.inc()

          return LiveStoreReact.useScopedQuery(() => {
            const query$ = queryDb({
              query: `select * from todos where id = '${id}'`,
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
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  // NOTE this test covers some special react lifecyle paths which I couldn't easily reproduce without react-window
  // it basically causes a "query swap" in the `useMemo` and both a `useEffect` cleanup call.
  // To handle this properly we introduced the `_tag: 'destroyed'` state in the `spanAlreadyStartedCache`.
  it('should work for a list with react-window', () =>
    Effect.gen(function* () {
      const { wrapper } = yield* makeTodoMvcReact()

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
        const res = LiveStoreReact.useScopedQuery(() => LiveStore.computed(() => id, { label: `ListItem.${id}` }), id)
        return <div role="listitem">{res}</div>
      }

      const renderResult = render(<ListWrapper numItems={1} />, { wrapper })

      expect(renderResult.container.textContent).toBe('0')

      renderResult.rerender(<ListWrapper numItems={2} />)

      expect(renderResult.container.textContent).toBe('10')
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))
})
