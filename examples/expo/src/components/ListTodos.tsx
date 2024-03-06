import { querySQL } from '@livestore/livestore'
import { useQuery } from '@livestore/livestore/react'
import { FlashList } from '@shopify/flash-list'
import * as React from 'react'

import type { Todo as ITodo } from '../schema'
import { Todo } from './Todo.tsx'

const todos$ = querySQL<ITodo[]>('SELECT * FROM todos')

export const ListTodos: React.FC = () => {
  const todosData = useQuery(todos$)

  return (
    <FlashList
      data={todosData}
      renderItem={({ item }) => <Todo {...item} />}
      keyExtractor={(item) => item.id.toString()}
      estimatedItemSize={todosData.length}
    />
  )
}
