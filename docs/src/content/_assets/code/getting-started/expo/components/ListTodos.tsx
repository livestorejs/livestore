import { type FC, useCallback } from 'react'
import { Button, ScrollView, Text, View } from 'react-native'

import { visibleTodos$ } from '../livestore/queries.ts'
import { events, type tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const ListTodos: FC = () => {
  const store = useAppStore()
  const todos = store.useQuery(visibleTodos$)

  const toggleTodo = useCallback(
    ({ id, completed }: typeof tables.todos.Type) => {
      store.commit(completed === true ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
    },
    [store],
  )

  const clearCompleted = useCallback(() => {
    store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))
  }, [store])

  return (
    <View style={{ flex: 1, gap: 16 }}>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {todos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} onToggle={toggleTodo} />
        ))}
      </ScrollView>
      <Button title="Clear completed" onPress={clearCompleted} />
    </View>
  )
}

const TodoItem: FC<{
  todo: typeof tables.todos.Type
  onToggle: (todo: typeof tables.todos.Type) => void
}> = ({ todo, onToggle }) => {
  const store = useAppStore()
  const onTogglePress = useCallback(() => onToggle(todo), [onToggle, todo])
  const onDeletePress = useCallback(() => {
    store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))
  }, [store, todo.id])

  return (
    <View
      style={{
        borderRadius: 12,
        borderColor: '#d4d4d8',
        borderWidth: 1,
        padding: 16,
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '600' }}>{todo.text}</Text>
      <Text>{todo.completed === true ? 'Completed' : 'Pending'}</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title={todo.completed === true ? 'Mark pending' : 'Mark done'} onPress={onTogglePress} />
        <Button title="Delete" onPress={onDeletePress} />
      </View>
    </View>
  )
}
