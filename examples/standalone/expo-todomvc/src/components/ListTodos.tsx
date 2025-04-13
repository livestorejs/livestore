import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import { FlatList } from 'react-native'

import { app$ } from '../livestore/queries.ts'
import { tables } from '../livestore/schema.ts'
import { Todo } from './Todo.tsx'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(app$)
    return tables.todos.where({
      deletedAt: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

export const ListTodos: React.FC = () => {
  const visibleTodos = useQuery(visibleTodos$)

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
