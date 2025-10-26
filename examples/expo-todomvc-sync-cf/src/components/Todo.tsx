import { MaterialIcons } from '@expo/vector-icons'
import { useStore } from '@livestore/react'
import type React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import type { tables } from '../livestore/schema.ts'
import { events } from '../livestore/schema.ts'
import { Checkbox } from './Checkbox.tsx'

export const Todo: React.FC<typeof tables.todos.Type> = ({ id, text, completed }) => {
  const { store } = useStore()

  const handleDeleteTodo = () => store.commit(events.todoDeleted({ id, deletedAt: new Date() }))

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
