import type { LiveQueryDef } from '@livestore/livestore'
import type { useStore } from '@livestore/react'
import type { FC } from 'react'

declare const state$: LiveQueryDef<number>
declare const useAppStore: () => ReturnType<typeof useStore>

export const MyComponent: FC = () => {
  const store = useAppStore()
  const value = store.useQuery(state$)

  return <div>{value}</div>
}
