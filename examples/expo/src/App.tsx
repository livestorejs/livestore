import { makeDb } from '@livestore/expo'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { StyleSheet, Text, unstable_batchedUpdates, View } from 'react-native'

import { ListTodos } from './components/ListTodos.tsx'
import { Meta } from './components/Meta.tsx'
import { NewTodo } from './components/NewTodo.tsx'
import { schema } from './schema/index.ts'

export const App = () => {
  return (
    <View style={styles.container}>
      <LiveStoreProvider
        schema={schema}
        fallback={<Text>Loading...</Text>}
        boot={(db) => {
          db.execute(sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'call johannes', 1)`)
        }}
        makeDb={makeDb({ migrations: { strategy: 'from-mutation-log' } })}
        // NOTE This is currently necessary to properly batch updates in React Native
        batchUpdates={(run) => unstable_batchedUpdates(() => run())}
      >
        <NewTodo />
        <Meta />
        <ListTodos />
      </LiveStoreProvider>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
