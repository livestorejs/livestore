import type { LiveQueryDef } from '@livestore/livestore'
import { query } from '@livestore/solid'

declare const state$: LiveQueryDef<number>

export const MyComponent = () => {
  const value = query(state$, 0)

  return <div>{value()}</div>
}
