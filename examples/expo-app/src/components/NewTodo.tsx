import { useRow, useStore } from '@livestore/livestore/react'
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
    const idPrefix = new Date().toISOString()
    const todos = Array.from({ length: 50 }, (_, i) => ({ id: `${idPrefix}-${i}`, text: `Todo ${i}` }))
    store.mutate(...todos.map((todo) => mutations.addTodo(todo)))
  }
  const reset = () => store.mutate(mutations.clearAll({ deleted: Date.now() }))

  return (
    <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          value={newTodoText}
          onChangeText={updateNewTodoText}
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
