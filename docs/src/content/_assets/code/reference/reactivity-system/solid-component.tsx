import type { LiveQueryDef, Store } from '@livestore/livestore'

declare const store: Store & { useQuery: <T>(query: LiveQueryDef<T>) => () => T }
declare const state$: LiveQueryDef<number>

export const MyComponent = () => {
  const value = store.useQuery(state$)

  return <div>{value()}</div>
}
