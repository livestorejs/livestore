import type * as React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { queryDb } from '@livestore/livestore'

import { tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ deletedAt: null, completed: false }), {
  label: 'incompleteCount',
})

export const Meta: React.FC = () => {
  const store = useAppStore()
  const count = store.useQuery(incompleteCount$)

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{count} todos</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    backgroundColor: '#fff',
  },
  text: {
    color: 'black',
  },
})
