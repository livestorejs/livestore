import { createStorePromise, type LiveStoreSchema, type Store } from '@livestore/livestore'
import { getAbortSignal } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'

export const createStore = async <S extends LiveStoreSchema>(
  options: Parameters<typeof createStorePromise<S>>[0],
): Promise<Store<S>> => {
  // TODO Svelte really should a 'we're in a reaction' function
  // so that we know if it's safe to call `getAbortSignal`
  let signal
  try {
    signal = getAbortSignal()
  } catch {}

  const store = await createStorePromise<S>({
    signal,
    ...options,
  })

  const query = store.query
  const updates = new SvelteSet<{}>()

  // monkey-patch `store.query` to add some ✨ svelte magic ✨
  // TODO figure out the type errors
  store.query = (queryDef, ...args) => {
    if (queryDef._tag === 'def' && $effect.tracking()) {
      const query$ = queryDef.make(store.reactivityGraph.context!).value // TODO otel stuff?

      const token = {}

      // this will cause the effect/derived containing the `store.query(...)` call
      // to re-run when the query value changes in `onUpdate`
      updates.has(token)

      // TODO replace with `skipInitialRun` (right now it's buggy)
      let initial = true

      $effect(() => {
        const unsubscribe = store.subscribe(query$, {
          onUpdate: () => {
            if (initial) {
              initial = false
              return
            }

            updates.add(token)
          },
        })

        return () => {
          updates.delete(token)
          unsubscribe()
        }
      })
    }

    return query.call(store, queryDef, ...args)
  }

  return store
}
