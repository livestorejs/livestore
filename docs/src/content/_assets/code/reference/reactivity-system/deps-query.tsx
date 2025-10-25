import { queryDb, State, type Store } from '@livestore/livestore'
import type { ReactApi } from '@livestore/react'
import type { FC } from 'react'

const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text(),
      completed: State.SQLite.boolean({ default: false }),
    },
  }),
} as const

declare const store: Store & ReactApi

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
  const todos = store.useQuery(todos$({ showCompleted })) as ReadonlyArray<{
    id: string
    text: string
    completed: boolean
  }>

  return <div>{todos.length} Done</div>
}
