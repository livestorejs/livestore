import {
  type CreateStoreOptionsPromise,
  createStorePromise,
  isLiveQueryDef,
  type LiveStoreSchema,
  type Queryable,
  type RefreshReason,
  type Schema,
  type SqlBindParams,
  type Store,
} from '@livestore/livestore'
import { omitUndefineds } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import { getAbortSignal } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'

/**
 * Creates a LiveStore store instance with automatic Svelte reactivity for `.query` calls.
 *
 * - Call `store.query` inside `$effect`/derived blocks to auto-update when data changes.
 * - Uses Svelte's abort signal (when present) so requests cancel on teardown.
 *
 * Example:
 * ```ts
 * <script lang="ts">
 *   import { queryDb } from '@livestore/livestore'
 *   import { createStore } from '@livestore/svelte'
 *
 *   import { schema, tables } from './livestore/schema.ts'
 *   import { adapter } from './livestore/adapter.ts'
 *
 *   const store = await createStore<typeof schema>({ adapter, schema, storeId: 'default' })
 *   const todos$ = queryDb(tables.todos.where({ deletedAt: null }), { label: 'todos' })
 * </script>
 *
 * <ul>
 *   {#each store.query(todos$) as todo (todo.id)}
 *     <li>{todo.text}</li>
 *   {/each}
 * </ul>
 * ```
 */
export const createStore = async <TSchema extends LiveStoreSchema>(
  options: CreateStoreOptionsPromise<TSchema>,
): Promise<Store<TSchema>> => {
  // TODO Svelte really should a 'we're in a reaction' function
  // so that we know if it's safe to call `getAbortSignal`
  let signal: AbortSignal | undefined
  try {
    signal = getAbortSignal()
  } catch {}

  const store = await createStorePromise<TSchema>({
    ...options,
    ...omitUndefineds({ signal }),
  })

  const updates = new SvelteSet<{}>()

  const originalQuery = store.query

  // monkey-patch `store.query` to add some ✨ svelte magic ✨
  store.query = <TResult>(
    queryDef: Queryable<TResult> | { query: string; bindValues: SqlBindParams; schema?: Schema.Schema<TResult> },
    options?: { otelContext?: otel.Context; debugRefreshReason?: RefreshReason },
  ): TResult => {
    // TODO support other query types
    if (isLiveQueryDef(queryDef) && queryDef._tag === 'def' && $effect.tracking()) {
      const token = {}

      // this will cause the effect/derived containing the `store.query(...)` call
      // to re-run when the query value changes in `onUpdate`
      updates.has(token)

      let initial = true

      $effect(() => {
        const unsubscribe = store.subscribe(queryDef, () => {
          if (initial) {
            initial = false
            return
          }

          updates.add(token)
        })

        return () => {
          updates.delete(token)
          unsubscribe()
        }
      })
    }

    // Fallback to the original query implementation
    return originalQuery(queryDef, options)
  }

  return store
}
