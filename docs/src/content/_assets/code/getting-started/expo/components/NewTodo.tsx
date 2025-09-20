/// <reference lib="dom" />
/// <reference path="../types.d.ts" />

import { useQuery, useStore } from '@livestore/react'
import { type FC } from 'react'
import { Button, TextInput, View } from 'react-native'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'

export const NewTodo: FC = () => {
  const { store } = useStore()
  const { newTodoText } = useQuery(uiState$)

  const updateText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))
  const createTodo = () =>
    store.commit(
      events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      events.uiStateSet({ newTodoText: '' }),
    )

  const addSampleTodos = () => {
    const todos = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      text: `Todo ${index + 1}`,
    }))
    store.commit(...todos.map((todo) => events.todoCreated(todo)))
  }

  return (
    <View style={{ gap: 12 }}>
      <TextInput value={newTodoText} onChangeText={updateText} placeholder="What needs to be done?" />
      <Button title="Add todo" onPress={createTodo} />
      <Button title="Add sample todos" onPress={addSampleTodos} />
    </View>
  )
}
