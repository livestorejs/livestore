import { querySQL } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/livestore/react'
import { Pressable, Text, View } from 'react-native'

import type { Todo } from './schema'

const todos$ = querySQL<Todo>('SELECT * FROM todos', { queriedTables: new Set(['todos']) })

export const Todos: React.FC = () => {
  const { store } = useStore()
  const todos = useQuery(todos$)

  return (
    <View>
      <Text>Hello World</Text>
      <Text>{JSON.stringify(todos)}</Text>
      <Pressable
        onPress={() => {
          store.applyEvent('addTodo', {
            id: new Date().toISOString(),
            text: 'hello',
            completed: false,
          })
        }}
      >
        <Text>Add Todo</Text>
      </Pressable>
    </View>
  )
}
