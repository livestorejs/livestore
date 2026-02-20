import { type FC, useCallback } from 'react'
import { Button, ScrollView, Text, View } from 'react-native'

import { visibleTodos$ } from '../livestore/queries.ts'
import { events, type tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const containerStyle = { flex: 1, gap: 16 }
const listContentStyle = { gap: 12 }
const todoCardStyle = {
  borderRadius: 12,
  borderColor: '#d4d4d8',
  borderWidth: 1,
  padding: 16,
  gap: 8,
}
const todoTitleStyle = { fontSize: 16, fontWeight: '600' as const }
const todoActionsStyle = { flexDirection: 'row' as const, gap: 12 }

type Todo = typeof tables.todos.Type

type TodoCardProps = {
  store: ReturnType<typeof useAppStore>
  todo: Todo
}

const TodoCard: FC<TodoCardProps> = ({ store, todo }) => {
  const toggleTodo = useCallback(() => {
    store.commit(
      todo.completed === true ? events.todoUncompleted({ id: todo.id }) : events.todoCompleted({ id: todo.id }),
    )
  }, [store, todo.completed, todo.id])

  const deleteTodo = useCallback(() => {
    store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))
  }, [store, todo.id])

  return (
    <View style={todoCardStyle}>
      <Text style={todoTitleStyle}>{todo.text}</Text>
      <Text>{todo.completed === true ? 'Completed' : 'Pending'}</Text>
      <View style={todoActionsStyle}>
        <Button title={todo.completed === true ? 'Mark pending' : 'Mark done'} onPress={toggleTodo} />
        <Button title="Delete" onPress={deleteTodo} />
      </View>
    </View>
  )
}

export const ListTodos: FC = () => {
  const store = useAppStore()
  const todos = store.useQuery(visibleTodos$)

  const clearCompleted = useCallback(() => {
    store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))
  }, [store])

  return (
    <View style={containerStyle}>
      <ScrollView contentContainerStyle={listContentStyle}>
        {todos.map((todo) => (
          <TodoCard key={todo.id} store={store} todo={todo} />
        ))}
      </ScrollView>
      <Button title="Clear completed" onPress={clearCompleted} />
    </View>
  )
}
