import type { LiveStoreSchema, Queryable, Store } from '@livestore/livestore'
import { render, waitFor } from '@testing-library/svelte'
import * as vitest from 'vitest'

import Harness from './__fixtures__/Harness.svelte'

/**
 * Renders a minimal Svelte component that calls `store.query` inside `$effect` to
 * exercise the real reactivity wiring. Captures each emission via `onSnapshot`.
 */
export const renderQueryHarness = <TSchema extends LiveStoreSchema, TResult>(
  store: Store<TSchema>,
  query: Queryable<TResult>,
): { snapshots: Array<TResult>; unmount: () => void } => {
  const snapshots: Array<TResult> = []

  const { unmount } = render(Harness, {
    props: {
      mode: 'query',
      store,
      query,
      onSnapshot: (rows: TResult) => {
        snapshots.push(rows)
      },
    },
  })

  return { snapshots, unmount }
}

/**
 * Renders a harness that allows swapping the queryable to validate token cleanup.
 */
export const renderSwappableHarness = <TSchema extends LiveStoreSchema, TResult>(
  store: Store<TSchema>,
  initialQuery: Queryable<TResult>,
): { snapshots: Array<TResult>; updateQuery: (next: Queryable<TResult>) => void; unmount: () => void } => {
  const snapshots: Array<TResult> = []
  let setQuery: ((next: Queryable<TResult>) => void) | undefined

  const { unmount } = render(Harness, {
    props: {
      mode: 'query',
      store,
      query: initialQuery,
      onSnapshot: (rows: TResult) => {
        snapshots.push(rows)
      },
      onRegisterSetter: (setter: (next: Queryable<TResult>) => void) => {
        setQuery = setter
      },
    },
  })

  const updateQuery = (next: Queryable<TResult>) => {
    setQuery?.(next)
  }

  return { snapshots, updateQuery, unmount }
}

/**
 * Waits until the last captured snapshot equals the expected value, leveraging
 * Testing Library's retry loop to give the reactive updates time to propagate.
 */
export const waitForLastSnapshot = async <TResult>(snapshots: Array<TResult>, expected: TResult) =>
  waitFor(() => {
    vitest.expect(snapshots.at(-1)).toEqual(expected)
  })
