import {
  createStorePromise,
  type LiveQuery,
  type LiveQueryDef,
  type LiveStoreSchema,
  type Store as CoreStore,
} from '@livestore/livestore'
import { type LiveQueries } from '@livestore/livestore/internal'

export type SvelteStore<S extends LiveStoreSchema> = CoreStore<S> & {
  createQuery: <TQuery extends LiveQueryDef.Any>(queryDef: TQuery) => () => LiveQueries.GetResult<TQuery>
}

const runQuery = <TQuery extends LiveQueryDef.Any>(
  query$: LiveQuery<LiveQueries.GetResult<TQuery>>,
  // TODO otelContext
): LiveQueries.GetResult<TQuery> => {
  try {
    return query$.run({
      // otelContext,
      debugRefreshReason: {
        _tag: 'react', // TODO should be Svelte but the types don't allow it (there's a TODO over there to broaden it)
        api: 'createQuery',
        label: `createQuery:initial-run:${query$.label}`,
        // TODO I don't get this stackInfo stuff
      },
    })
  } catch (cause: any) {
    console.error('[@livestore/svelte:createQuery] Error running query', cause)
    throw new Error(
      `\
[@livestore/svelte:createQuery] Error running query: ${cause.name}

Query: ${query$.label}

Stack trace:
`,
      { cause },
    )
  }
}

const withSvelteApi = <S extends LiveStoreSchema>(store: CoreStore<S>): SvelteStore<S> => {
  // @ts-expect-error TODO not sure of a better way to implement this -- maybe extend the CoreStore?
  store.createQuery = <TQuery extends LiveQueryDef.Any>(queryDef: TQuery) => {
    const query$ = queryDef.make(store.reactivityGraph.context!).value // TODO otel stuff?
    let result = $state.raw(runQuery<TQuery>(query$)) // todo otel stuff?
    $effect(() => {
      return store.subscribe(query$, {
        onUpdate: (newValue) => {
          result = newValue
        },
        label: query$.label,
        // otelContext, TODO?
      })
    })
    return () => result
  }
  return store as SvelteStore<S>
}

export const createStore = async <S extends LiveStoreSchema>(
  ...args: Parameters<typeof createStorePromise<S>>
): Promise<SvelteStore<S>> => {
  let shutdown = $state.raw(() => {})
  // we need to register the effect prior to the store creation -- the effect will rerun when we assign to `shutdown` and then never thereafter
  $effect(() => shutdown)
  const store = await createStorePromise<S>(...args).then(withSvelteApi)
  shutdown = store.shutdown
  return store
}
