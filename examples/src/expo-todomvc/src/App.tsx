import { makePersistedAdapter } from '@livestore/adapter-expo'
import { nanoid } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/react'
import { makeWsSync } from '@livestore/sync-cf'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { Button, StyleSheet, Text, unstable_batchedUpdates as batchUpdates, View } from 'react-native'

import { Filters } from './components/Filters.tsx'
import { ListTodos } from './components/ListTodos.tsx'
import { Meta } from './components/Meta.tsx'
import { NewTodo } from './components/NewTodo.tsx'
import { mutations, schema, tables } from './livestore/schema.ts'

const storeId = process.env.EXPO_PUBLIC_LIVESTORE_STORE_ID ?? nanoid(6)
const syncUrl = process.env.EXPO_PUBLIC_LIVESTORE_SYNC_URL

const adapter = makePersistedAdapter({
  sync: { makeBackend: syncUrl ? ({ storeId }) => makeWsSync({ url: syncUrl, storeId }) : undefined },
})

export const App = () => {
  const [, rerender] = React.useState({})

  return (
    <View style={styles.container}>
      <LiveStoreProvider
        schema={schema}
        renderLoading={(_) => <Text>Loading LiveStore ({_.stage})...</Text>}
        renderError={(error: any) => <Text>Error: {error.toString()}</Text>}
        renderShutdown={() => {
          return (
            <View>
              <Text>LiveStore Shutdown</Text>
              <Button title="Reload" onPress={() => rerender({})} />
            </View>
          )
        }}
        boot={(store) => {
          if (store.query(tables.todos.query.count()) === 0) {
            store.mutate(mutations.todoCreated({ id: nanoid(), text: 'Make coffee' }))
          }
        }}
        adapter={adapter}
        batchUpdates={batchUpdates}
        storeId={storeId}
      >
        <InnerApp />
      </LiveStoreProvider>
      <StatusBar style="auto" />
    </View>
  )
}

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
