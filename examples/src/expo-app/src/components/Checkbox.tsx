import { Entypo } from '@expo/vector-icons'
import { useStore } from '@livestore/react'
import * as React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import { mutations } from '../schema/index.ts'

export const Checkbox: React.FC<{
  id: string
  isCompleted: boolean
}> = ({ id, isCompleted }) => {
  const { store } = useStore()

  const handleCheckbox = () =>
    store.mutate(isCompleted ? mutations.uncompleteTodo({ id }) : mutations.completeTodo({ id }))

  return (
    <TouchableOpacity onPress={handleCheckbox} style={isCompleted ? styles.checked : styles.unChecked}>
      <Entypo name="check" size={16} color="#FAFAFA" />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  checked: {
    width: 20,
    height: 20,
    marginRight: 13,
    borderRadius: 6,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  unChecked: {
    width: 20,
    height: 20,
    marginRight: 13,
    borderWidth: 2,
    borderColor: '#E8E8E8',
    borderRadius: 6,
    backgroundColor: '#fff',
    marginLeft: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  isToday: {
    width: 10,
    height: 10,
    marginHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#262626',
    marginRight: 13,
    marginLeft: 15,
  },
})
