import { render, waitFor } from '@testing-library/svelte'
import * as vitest from 'vitest'

import type { LiveStoreSchema, Queryable, Store } from '@livestore/livestore'

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
 * Renders a harness where we can trigger `$effect` reruns via an external dependency
 * to verify cleanup behavior without swapping query references.
 */
export const renderRerunHarness = <TSchema extends LiveStoreSchema, TResult>(
  store: Store<TSchema>,
  query: Queryable<TResult>,
): { snapshots: Array<TResult>; updateDep: (next: unknown) => void; unmount: () => void } => {
  const snapshots: Array<TResult> = []
  let setDep: ((next: unknown) => void) | undefined

  const { unmount } = render(Harness, {
    props: {
      mode: 'query',
      store,
      query,
      onSnapshot: (rows: TResult) => {
        snapshots.push(rows)
      },
      onRegisterDepSetter: (setter: (next: unknown) => void) => {
        setDep = setter
      },
    },
  })

  const updateDep = (next: unknown) => {
    setDep?.(next)
  }

  return { snapshots, updateDep, unmount }
}

/**
 * Waits until the last captured snapshot equals the expected value, leveraging
 * Testing Library's retry loop to give the reactive updates time to propagate.
 */
export const waitForLastSnapshot = async <TResult>(snapshots: Array<TResult>, expected: TResult) =>
  waitFor(() => {
    vitest.expect(snapshots.at(-1)).toEqual(expected)
  })
