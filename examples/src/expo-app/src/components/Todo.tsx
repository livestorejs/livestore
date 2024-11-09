import { MaterialIcons } from '@expo/vector-icons'
import { useStore } from '@livestore/react'
import * as React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import type { Todo as ITodo } from '../schema/index.js'
import { mutations } from '../schema/index.js'
import { Checkbox } from './Checkbox.js'

export const Todo: React.FC<ITodo> = ({ id, text, completed }) => {
  const { store } = useStore()

  const handleDeleteTodo = () => store.mutate(mutations.deleteTodo({ id, deleted: Date.now() }))

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Checkbox id={id} isCompleted={completed} />
        <View style={{ flex: 1 }}>
          <Text
            selectable
            style={completed ? [styles.text, { textDecorationLine: 'line-through', color: '#73737330' }] : styles.text}
          >
            {text}
          </Text>
        </View>
        <TouchableOpacity onPress={handleDeleteTodo}>
          <MaterialIcons name="delete-outline" size={24} color="#73737340" style={styles.delete} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {
    fontSize: 15,
    fontWeight: '500',
    color: '#737373',
  },
  time: {
    fontSize: 13,
    color: '#a3a3a3',
    fontWeight: '500',
  },
  delete: {
    marginRight: 10,
  },
})
