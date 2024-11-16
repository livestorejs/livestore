import { querySQL } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import { FlatList } from 'react-native'

import { tables } from '../schema/index.ts'
import { Todo } from './Todo.tsx'

const filterClause$ = querySQL(tables.app.query.select('filter').first(), { label: 'filterClause' })

const visibleTodos$ = querySQL(
  (get) => {
    const { filter } = get(filterClause$)
    return tables.todos.query.where({
      deleted: null,
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
