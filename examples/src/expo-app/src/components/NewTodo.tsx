import { useRow, useStore } from '@livestore/react'
import { cuid } from '@livestore/utils/cuid'
import React from 'react'
import { Keyboard, Pressable, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native'

import { mutations, tables } from '../schema/index.ts'

export const NewTodo: React.FC = () => {
  const { store } = useStore()
  const [{ newTodoText }] = useRow(tables.app)

  const updateNewTodoText = (text: string) => store.mutate(mutations.updateNewTodoText({ text }))
  const addTodo = () =>
    store.mutate(
      mutations.addTodo({ id: new Date().toISOString(), text: newTodoText }),
      mutations.updateNewTodoText({ text: '' }),
    )
  const addRandom50 = () => {
    const todos = Array.from({ length: 50 }, (_, i) => ({ id: cuid(), text: `Todo ${i}` }))
    store.mutate(...todos.map((todo) => mutations.addTodo(todo)))
  }
  const reset = () => store.mutate(mutations.clearAll({ deleted: Date.now() }))

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
          onChangeText={updateNewTodoText}
          onKeyPress={(e) => {
            console.log(e.nativeEvent.key)
            if (e.nativeEvent.key === 'Escape' || e.nativeEvent.key === 'Tab') {
              Keyboard.dismiss()
              inputRef.current?.blur()
            }
          }}
          onSubmitEditing={addTodo}
        />
        <Pressable onPress={addTodo}>
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
