import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { StatusBar } from 'expo-status-bar'
import { type FC, Suspense, useState } from 'react'
import { SafeAreaView, Text, View } from 'react-native'

import { ListTodos } from './components/ListTodos.tsx'
import { NewTodo } from './components/NewTodo.tsx'

const appContentStyle = { flex: 1, gap: 24, padding: 24 }
const safeAreaStyle = { flex: 1 }
const loadingFallback = <Text>Loading LiveStore...</Text>

const AppContent: FC = () => (
  <View style={appContentStyle}>
    <NewTodo />
    <ListTodos />
  </View>
)

export const Root: FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <SafeAreaView style={safeAreaStyle}>
      <Suspense fallback={loadingFallback}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <AppContent />
        </StoreRegistryProvider>
      </Suspense>
      <StatusBar />
    </SafeAreaView>
  )
}
