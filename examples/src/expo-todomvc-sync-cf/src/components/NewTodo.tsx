import { nanoid } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import React from 'react'
import { Keyboard, Pressable, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'

export const NewTodo: React.FC = () => {
  const { store } = useStore()
  const { newTodoText } = useQuery(uiState$)

  const updatedNewTodoText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))
  const todoCreated = () =>
    store.commit(
      events.todoCreated({ id: new Date().toISOString(), text: newTodoText }),
      events.uiStateSet({ newTodoText: '' }),
    )
  const addRandom50 = () => {
    const todos = Array.from({ length: 50 }, (_, i) => ({ id: nanoid(), text: `Todo ${i}` }))
    store.commit(...todos.map((todo) => events.todoCreated(todo)))
  }
  const reset = () => store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))

  const inputRef = React.useRef<TextInput>(null)

  return (
    <TouchableWithoutFeedback
      onPress={() => {
        Keyboard.dismiss()
        inputRef.current?.blur()
      }}
    >
      <View style={styles.container}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={newTodoText}
          onChangeText={updatedNewTodoText}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Escape' || e.nativeEvent.key === 'Tab') {
              Keyboard.dismiss()
              inputRef.current?.blur()
            }
          }}
          onSubmitEditing={todoCreated}
        />
        <Pressable onPress={todoCreated}>
          <Text style={styles.submit}>Add</Text>
        </Pressable>
        <Pressable onPress={addRandom50}>
          <Text style={styles.submit}>Random (50)</Text>
        </Pressable>
        <Pressable onPress={reset}>
          <Text style={styles.submit}>Clear</Text>
        </Pressable>
      </View>
    </TouchableWithoutFeedback>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    flexGrow: 0,
    flexBasis: 100,
    flexShrink: 0,
    alignItems: 'center',
    padding: 10,
    width: 400,
  },
  input: {
    height: 40,
    width: 200,
    margin: 12,
    borderWidth: 1,
    borderRadius: 6,
  },
  submit: {
    padding: 4,
    // backgroundColor: 'blue',
    borderRadius: 6,
    fontSize: 12,
  },
})
