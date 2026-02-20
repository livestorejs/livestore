import { type FC, useCallback } from 'react'
import { Button, TextInput, View } from 'react-native'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const containerStyle = { gap: 12 }

export const NewTodo: FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updateText = useCallback(
    (text: string) => {
      store.commit(events.uiStateSet({ newTodoText: text }))
    },
    [store],
  )

  const createTodo = useCallback(() => {
    store.commit(
      events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      events.uiStateSet({ newTodoText: '' }),
    )
  }, [newTodoText, store])

  const addSampleTodos = useCallback(() => {
    const todos = Array.from({ length: 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      text: `Todo ${index + 1}`,
    }))
    store.commit(...todos.map((todo) => events.todoCreated(todo)))
  }, [store])

  return (
    <View style={containerStyle}>
      <TextInput value={newTodoText} onChangeText={updateText} placeholder="What needs to be done?" />
      <Button title="Add todo" onPress={createTodo} />
      <Button title="Add sample todos" onPress={addSampleTodos} />
    </View>
  )
}
