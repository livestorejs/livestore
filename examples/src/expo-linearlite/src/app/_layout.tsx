import '../global.css'
import '../polyfill.ts'
import 'react-native-reanimated'

import { makeAdapter } from '@livestore/adapter-expo'
import type { BaseGraphQLContext, LiveStoreSchema, Store } from '@livestore/livestore'
import { nanoid } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/react'
import { Stack } from 'expo-router'
import React from 'react'
import { Button, LogBox, Platform, Text, unstable_batchedUpdates as batchUpdates, View } from 'react-native'

import { LoadingLiveStore } from '@/components/LoadingLiveStore.tsx'
import { NavigationHistoryTracker } from '@/context/navigation-history.tsx'
import ThemeProvider from '@/context/ThemeProvider.tsx'

import { schema, tables, userMutations } from '../livestore/schema.ts'

// export const unstable_settings = {
//   // Ensure any route can link back to `/`
//   initialRouteName: '/',
// };

LogBox.ignoreAllLogs()

const RootLayout = () => {
  const adapter = makeAdapter()
  const [, rerender] = React.useState({})

  return (
    <LiveStoreProvider
      schema={schema}
      renderLoading={(_) => <LoadingLiveStore stage={_.stage} />}
      // disableDevtools={true}
      renderError={(error: any) => (
        <View className="flex-1 items-center justify-center">
          <Text>Error: {JSON.stringify(error, null, 2)}</Text>
        </View>
      )}
      renderShutdown={() => {
        return (
          <View className="flex-1 items-center justify-center">
            <Text>LiveStore Shutdown</Text>
            <Button title="Reload" onPress={() => rerender({})} />
          </View>
        )
      }}
      boot={boot}
      adapter={adapter}
      batchUpdates={batchUpdates}
    >
      <NavigationHistoryTracker />
      <ThemeProvider>
        <Stack screenOptions={{ freezeOnBlur: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="filter-settings"
            options={{
              presentation: Platform.OS === 'ios' ? 'formSheet' : 'modal',
              sheetAllowedDetents: [0.4],
              sheetCornerRadius: 16,
              sheetGrabberVisible: true,
              headerShown: Platform.OS === 'android',
            }}
          />
          <Stack.Screen
            name="issue-details"
            options={{
              freezeOnBlur: false,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen name="edit-issue" options={{ presentation: 'modal', freezeOnBlur: false }} />
        </Stack>
      </ThemeProvider>
    </LiveStoreProvider>
  )
}

/**
 * This function is called when the app is booted.
 * It is used to initialize the database with some data.
 */
const boot = (store: Store<BaseGraphQLContext, LiveStoreSchema>) => {
  if (store.query(tables.users.query.count()) === 0) {
    store.mutate(
      userMutations.createUser({
        id: nanoid(),
        name: 'Beto',
        email: 'beto@expo.io',
        photoUrl: 'https://avatars.githubusercontent.com/u/43630417?v=4',
      }),
    )
  }
}

export default RootLayout
