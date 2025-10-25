import type { LiveQueryDef } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import type { FC } from 'react'

declare const state$: LiveQueryDef<number>

export const MyComponent: FC = () => {
  const value = useQuery(state$)

  return <div>{value}</div>
}
