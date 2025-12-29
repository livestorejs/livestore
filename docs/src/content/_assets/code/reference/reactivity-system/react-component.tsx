import { queryDb } from '@livestore/livestore'
import type { FC } from 'react'
import { tables } from '../framework-integrations/react/schema.ts'
import { useAppStore } from '../framework-integrations/react/store.ts'

const todos$ = queryDb(tables.todos.orderBy('createdAt', 'desc'), { label: 'todos' })

export const TodoList: FC = () => {
  const store = useAppStore()
  const todos = store.useQuery(todos$)

  return <div>{todos.length} items</div>
}
