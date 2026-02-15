import { Suspense, useState } from 'react'
import { unstable_batchedUpdates as batchUpdates, SafeAreaView, Text } from 'react-native'

import { makePersistedAdapter } from '@livestore/adapter-expo'
import { queryDb, StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'

import { schema, tables } from './schema.ts'

const adapter = makePersistedAdapter()

const useAppStore = () =>
  useStore({
    storeId: 'my-app',
    schema,
    adapter,
    batchUpdates,
  })

export const App = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Suspense fallback={<Text>Loading...</Text>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <TodoList />
        </StoreRegistryProvider>
      </Suspense>
    </SafeAreaView>
  )
}

const TodoList = () => {
  const store = useAppStore()
  const todos = store.useQuery(queryDb(tables.todos.select()))
  return <Text>{todos.length} todos</Text>
}
