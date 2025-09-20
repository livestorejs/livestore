/// <reference path="../types.d.ts" />

import { useQuery, useStore } from '@livestore/react'
import { type FC, useCallback } from 'react'
import { Button, ScrollView, Text, View } from 'react-native'

import { visibleTodos$ } from '../livestore/queries.ts'
import { events, type tables } from '../livestore/schema.ts'

export const ListTodos: FC = () => {
  const { store } = useStore()
  const todos = useQuery(visibleTodos$)

  const toggleTodo = useCallback(
    ({ id, completed }: typeof tables.todos.Type) => {
      store.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
    },
    [store],
  )

  const clearCompleted = () => store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))

  return (
    <View style={{ flex: 1, gap: 16 }}>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {todos.map((todo) => (
          <View
            key={todo.id}
            style={{
              borderRadius: 12,
              borderColor: '#d4d4d8',
              borderWidth: 1,
              padding: 16,
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{todo.text}</Text>
            <Text>{todo.completed ? 'Completed' : 'Pending'}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title={todo.completed ? 'Mark pending' : 'Mark done'} onPress={() => toggleTodo(todo)} />
              <Button
                title="Delete"
                onPress={() => store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))}
              />
            </View>
          </View>
        ))}
      </ScrollView>
      <Button title="Clear completed" onPress={clearCompleted} />
    </View>
  )
}
