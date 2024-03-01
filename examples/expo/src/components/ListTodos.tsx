import { querySQL } from '@livestore/livestore'
import { useQuery } from '@livestore/livestore/react'
import * as React from 'react'
import { FlatList } from 'react-native'

import type { Todo as ITodo } from '../schema'
import { Todo } from './Todo.tsx'

const todos$ = querySQL<ITodo[]>('SELECT * FROM todos')

export const ListTodos: React.FC = () => {
  const todosData = useQuery(todos$)

  return (
    <FlatList
      data={todosData}
      renderItem={({ item }) => <Todo {...item} />}
      keyExtractor={(item) => item.id.toString()}
    />
  )
}
