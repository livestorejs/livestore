import type { LiveQueryDef } from '@livestore/livestore'
import type { FC } from 'react'
import { useAppStore } from '../framework-integrations/react/store.ts'

declare const state$: LiveQueryDef<number>

export const MyComponent: FC = () => {
  const store = useAppStore()
  const value = store.useQuery(state$)

  return <div>{value}</div>
}
