import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import * as React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { tables } from '../livestore/schema.ts'

const incompleteCount$ = queryDb(tables.todos.query.count().where({ deleted: null, completed: false }), {
  label: 'incompleteCount',
})

export const Meta: React.FC = () => {
  const count = useQuery(incompleteCount$)

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
