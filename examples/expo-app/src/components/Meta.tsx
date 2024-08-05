import { Schema } from '@effect/schema'
import { querySQL } from '@livestore/livestore'
import { useQuery } from '@livestore/livestore/react'
import * as React from 'react'
import { StyleSheet, Text, View } from 'react-native'

const count$ = querySQL('SELECT count(*) as count FROM todos', {
  schema: Schema.Struct({ count: Schema.Number }).pipe(Schema.pluck('count'), Schema.Array, Schema.headOrElse()),
})

export const Meta: React.FC = () => {
  const count = useQuery(count$)

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
