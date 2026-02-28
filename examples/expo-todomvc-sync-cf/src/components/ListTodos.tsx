import { queryDb } from '@livestore/livestore'
import { useCallback } from 'react'
import { FlatList } from 'react-native'

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

export const ListTodos = () => {
  const store = useAppStore()
  const visibleTodos = store.useQuery(visibleTodos$)
  const renderTodo = useCallback(({ item }: { item: (typeof visibleTodos)[number] }) => <Todo {...item} />, [])
  const keyExtractor = useCallback((item: (typeof visibleTodos)[number]) => item.id.toString(), [])

  return (
    <FlatList
      data={visibleTodos}
      renderItem={renderTodo}
      keyExtractor={keyExtractor}
      initialNumToRender={20}
      maxToRenderPerBatch={20}
    />
  )
}
