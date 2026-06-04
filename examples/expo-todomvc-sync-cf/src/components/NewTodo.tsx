import { nanoid } from '@livestore/livestore'
import { useCallback, useRef } from 'react'
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native'
import { Keyboard, Pressable, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const NewTodo: React.FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )
  const todoCreated = useCallback(
    () => store.commit(events.todoCreated({ id: nanoid(), text: newTodoText }), events.uiStateSet({ newTodoText: '' })),
    [newTodoText, store],
  )
  const addRandom50 = useCallback(() => {
    const todos = Array.from({ length: 50 }, (_, i) => ({ id: nanoid(), text: `Todo ${i}` }))
    store.commit(...todos.map((todo) => events.todoCreated(todo)))
  }, [store])
  const reset = useCallback(() => store.commit(events.todoClearedCompleted({ deletedAt: new Date() })), [store])

  const inputRef = useRef<TextInput>(null)
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss()
    inputRef.current?.blur()
  }, [])
  const handleInputKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key === 'Escape' || e.nativeEvent.key === 'Tab') {
        dismissKeyboard()
      }
    },
    [dismissKeyboard],
  )

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      <View style={styles.container}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={newTodoText}
          onChangeText={updatedNewTodoText}
          onKeyPress={handleInputKeyPress}
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
