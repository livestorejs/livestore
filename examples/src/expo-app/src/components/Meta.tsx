import { querySQL, sql } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import { Schema } from 'effect'
import * as React from 'react'
import { StyleSheet, Text, View } from 'react-native'

const incompleteCount$ = querySQL(sql`select count(*) as c from todos where completed = false and deleted is null`, {
  schema: Schema.Struct({ c: Schema.Number }).pipe(Schema.pluck('c'), Schema.Array, Schema.headOrElse()),
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
