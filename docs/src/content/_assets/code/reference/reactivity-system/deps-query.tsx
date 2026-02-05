import type { FC } from 'react'

import { queryDb } from '@livestore/livestore'

import { tables } from '../framework-integrations/react/schema.ts'
import { useAppStore } from '../framework-integrations/react/store.ts'

export const todos$ = ({ showCompleted }: { showCompleted: boolean }) =>
  queryDb(
    () => {
      return tables.todos.where(showCompleted ? { completed: true } : {})
    },
    {
      label: 'todos$',
      deps: [showCompleted ? 'true' : 'false'],
    },
  )

export const MyComponent: FC<{ showCompleted: boolean }> = ({ showCompleted }) => {
  const store = useAppStore()
  const todos = store.useQuery(todos$({ showCompleted })) as ReadonlyArray<{
    id: string
    text: string
    completed: boolean
  }>

  return <div>{todos.length} Done</div>
}
