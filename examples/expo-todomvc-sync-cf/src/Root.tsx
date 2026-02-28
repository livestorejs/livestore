import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { StatusBar } from 'expo-status-bar'
import { Suspense, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Filters } from './components/Filters.tsx'
import { ListTodos } from './components/ListTodos.tsx'
import { Meta } from './components/Meta.tsx'
import { NewTodo } from './components/NewTodo.tsx'

const loadingFallback = <Text>Loading LiveStore...</Text>

export const Root = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <View style={styles.container}>
      <Suspense fallback={loadingFallback}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <InnerApp />
        </StoreRegistryProvider>
      </Suspense>
      <StatusBar />
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
