import { makeAdapter } from '@livestore/expo'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { StyleSheet, Text, unstable_batchedUpdates, View } from 'react-native'

import { Filters } from './components/Filters.tsx'
import { ListTodos } from './components/ListTodos.tsx'
import { Meta } from './components/Meta.tsx'
import { NewTodo } from './components/NewTodo.tsx'
import { schema } from './schema/index.ts'

const adapter = makeAdapter()

export const App = () => (
  <View style={styles.container}>
    <LiveStoreProvider
      schema={schema}
      renderLoading={(_) => <Text>Loading LiveStore ({_.stage})...</Text>}
      renderError={(error: any) => <Text>Error: {error.toString()}</Text>}
      renderShutdown={() => <Text>LiveStore Shutdown</Text>}
      boot={(db) => {
        db.execute(sql`INSERT OR IGNORE INTO todos (id, text, completed) VALUES ('t1', 'Make coffee', 1)`)
      }}
      adapter={adapter}
      // NOTE This is currently necessary to properly batch updates in React Native
      batchUpdates={(run) => unstable_batchedUpdates(() => run())}
    >
      <InnerApp />
    </LiveStoreProvider>
    <StatusBar style="auto" />
  </View>
)

const InnerApp = () => (
  <>
    <NewTodo />
    <Meta />
    <ListTodos />
    <Filters />
  </>
)

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 32,
  },
})
