import { type FC, useCallback } from 'react'
import { Button, TextInput, View } from 'react-native'

import { uiStateQuery } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const formContainerStyle = { gap: 12 }

export const NewTodo: FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiStateQuery(store.sessionId))

  const updateText = useCallback(
    (text: string) => {
      store.commit(events.todoDraftChanged({ id: store.sessionId, text }))
    },
    [store],
  )
  const createTodo = useCallback(() => {
    store.commit(
      events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      events.todoDraftChanged({ id: store.sessionId, text: '' }),
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
    <View style={formContainerStyle}>
      <TextInput value={newTodoText} onChangeText={updateText} placeholder="What needs to be done?" />
      <Button title="Add todo" onPress={createTodo} />
      <Button title="Add sample todos" onPress={addSampleTodos} />
    </View>
  )
}
