import { MaterialIcons } from '@expo/vector-icons'
import { useCallback } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import type { tables } from '../livestore/schema.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import { Checkbox } from './Checkbox.tsx'

export const Todo = ({ id, text, completed }: typeof tables.todos.Type) => {
  const store = useAppStore()

  const handleDeleteTodo = useCallback(
    () => store.commit(events.todoDeleted({ id, deletedAt: new Date() })),
    [id, store],
  )
  const textStyle = StyleSheet.compose(styles.text, completed ? styles.textCompleted : undefined)

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Checkbox id={id} isCompleted={completed} />
        <View style={styles.textContainer}>
          <Text selectable style={textStyle}>
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
  textCompleted: {
    textDecorationLine: 'line-through',
    color: '#73737330',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
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
