import { makePersistedAdapter } from '@livestore/adapter-expo'
import { LiveStoreProvider } from '@livestore/react'
import { makeWsSync } from '@livestore/sync-cf/client'
import { StatusBar } from 'expo-status-bar'
import type { FC } from 'react'
import { unstable_batchedUpdates as batchUpdates, SafeAreaView, Text, View } from 'react-native'

import { ListTodos } from './components/ListTodos.tsx'
import { NewTodo } from './components/NewTodo.tsx'
import { events, schema, tables } from './livestore/schema.ts'

const storeId = 'expo-todomvc'
const syncUrl = 'https://example.org/sync'

const adapter = makePersistedAdapter({
  sync: { backend: makeWsSync({ url: syncUrl }) },
})

export const Root: FC = () => (
  <SafeAreaView style={{ flex: 1 }}>
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      storeId={storeId}
      batchUpdates={batchUpdates}
      renderLoading={(status) => <Text>Loading LiveStore ({status.stage})...</Text>}
      renderError={(error) => <Text>Error: {String(error)}</Text>}
      renderShutdown={() => <Text>LiveStore shutdown</Text>}
      boot={(store) => {
        if (store.query(tables.todos.count()) === 0) {
          store.commit(events.todoCreated({ id: crypto.randomUUID(), text: 'Make coffee' }))
        }
      }}
    >
      <View style={{ flex: 1, gap: 24, padding: 24 }}>
        <NewTodo />
        <ListTodos />
      </View>
    </LiveStoreProvider>
    <StatusBar style="auto" />
  </SafeAreaView>
)
