import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type { FC } from 'react'

import { tables } from './schema.ts'

const query$ = queryDb(tables.todos.where({ completed: true }).orderBy('id', 'desc'), {
  label: 'completedTodos',
})

export const CompletedTodos: FC = () => {
  const { store } = useStore()
  const todos = store.useQuery(query$)

  return (
    <div>
      {todos.map((todo) => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  )
}
