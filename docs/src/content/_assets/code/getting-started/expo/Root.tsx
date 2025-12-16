import { StoreRegistry, StoreRegistryProvider } from '@livestore/react'
import { StatusBar } from 'expo-status-bar'
import { type FC, Suspense, useState } from 'react'
import { SafeAreaView, Text, View } from 'react-native'

import { ListTodos } from './components/ListTodos.tsx'
import { NewTodo } from './components/NewTodo.tsx'

const AppContent: FC = () => (
  <View style={{ flex: 1, gap: 24, padding: 24 }}>
    <NewTodo />
    <ListTodos />
  </View>
)

export const Root: FC = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Suspense fallback={<Text>Loading LiveStore...</Text>}>
        <StoreRegistryProvider storeRegistry={storeRegistry}>
          <AppContent />
        </StoreRegistryProvider>
      </Suspense>
      <StatusBar style="auto" />
    </SafeAreaView>
  )
}
