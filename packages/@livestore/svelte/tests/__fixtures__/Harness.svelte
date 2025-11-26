<script lang="ts">
import type { CreateStoreOptionsPromise, LiveStoreSchema, Queryable, Store } from '@livestore/livestore'
import { shouldNeverHappen } from '@livestore/utils'

import { createStore } from '../../src/create-store.svelte.ts'

/**
 * Minimal multipurpose harness for Svelte tests.
 *
 * - `mode: 'query'` (requires `store`, `query`) renders `store.query(...)` inside `$effect`
 *   and reports each emission via `onSnapshot`, with optional `onRegisterSetter` to swap queries.
 * - `mode: 'createStore'` (requires `options`) invokes `createStore` inside `$effect` so tests
 *   can observe abort-signal wiring via `onCreated`.
 */

  type Mode = 'query' | 'createStore'

  const {
    mode,
    store,
    query,
    options,
    onSnapshot = () => {},
    onRegisterSetter,
    onCreated = () => {},
    effectDep,
    onRegisterDepSetter,
  }: {
    mode: Mode
    store?: Store<LiveStoreSchema>
    query?: Queryable<unknown>
    options?: CreateStoreOptionsPromise<LiveStoreSchema>
    onSnapshot?: (value: unknown) => void
    onRegisterSetter?: (setQuery: (next: Queryable<unknown>) => void) => void
    onCreated?: (store: Store<LiveStoreSchema>) => void
    effectDep?: unknown
    onRegisterDepSetter?: (setDep: (next: unknown) => void) => void
  } = $props()

  let currentQuery = $state<Queryable<unknown> | undefined>(query)
  let effectDepState = $state<unknown>(effectDep)

  if (mode === 'query') {
    const liveStore = store ?? shouldNeverHappen('store is required for query mode')

    if (onRegisterSetter) {
      onRegisterSetter((next: Queryable<unknown>) => {
        currentQuery = next
      })
    }

    if (onRegisterDepSetter) {
      onRegisterDepSetter((next: unknown) => {
        effectDepState = next
      })
    }

    $effect(() => {
      // make effect rerun when the external dep changes
      void effectDepState
      const activeQuery = currentQuery ?? shouldNeverHappen('query is required for query mode')
      onSnapshot(liveStore.query(activeQuery))
    })
  } else if (mode === 'createStore') {
    if (!options) {
      shouldNeverHappen('options are required for createStore mode')
    } else {
      $effect(() => {
        void createStore(options)
          .then(onCreated)
          .catch(() => {
            // Abort during teardown will reject; swallow to avoid unhandled rejection in tests.
          })
      })
    }
  } else {
    shouldNeverHappen(`Unknown harness mode: ${String(mode)}`)
  }
</script>
