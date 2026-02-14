import type { FC } from 'react'

import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'
import { useAppStore } from './store.ts'

const query$ = queryDb(tables.todos.where({ completed: true }).orderBy('id', 'desc'), {
  label: 'completedTodos',
})

export const CompletedTodos: FC = () => {
  const store = useAppStore()
  const todos = store.useQuery(query$)

  return (
    <div>
      {todos.map((todo) => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  )
}
