import type React from 'react'
import { FlatList } from 'react-native'

import { queryDb } from '@livestore/livestore'

import { uiState$ } from '../livestore/queries.ts'
import { tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { Todo } from './Todo.tsx'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(uiState$)
    return tables.todos.where({
      deletedAt: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

export const ListTodos: React.FC = () => {
  const store = useAppStore()
  const visibleTodos = store.useQuery(visibleTodos$)

  return (
    <FlatList
      data={visibleTodos}
      renderItem={({ item }) => <Todo {...item} />}
      keyExtractor={(item) => item.id.toString()}
      initialNumToRender={20}
      maxToRenderPerBatch={20}
    />
  )
}
