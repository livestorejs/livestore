import '../polyfill.ts'
import 'react-native-reanimated'

import { makePersistedAdapter } from '@livestore/adapter-expo'
import type { Store } from '@livestore/livestore'
import { nanoid } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/react'
import { Stack } from 'expo-router'
import React from 'react'
import {
  Button,
  unstable_batchedUpdates as batchUpdates,
  LogBox,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native'

import { LoadingLiveStore } from '@/components/LoadingLiveStore.tsx'
import { darkBackground, darkText, nordicGray } from '@/constants/Colors.ts'
import { NavigationHistoryTracker } from '@/context/navigation-history.tsx'
import ThemeProvider from '@/context/ThemeProvider.tsx'

import { events, schema, tables } from '../livestore/schema.ts'

// export const unstable_settings = {
//   // Ensure any route can link back to `/`
//   initialRouteName: '/',
// };

LogBox.ignoreAllLogs()

const RootLayout = () => {
  const adapter = makePersistedAdapter()
  const [, rerender] = React.useState({})
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? darkBackground : 'white',
    },
    text: {
      color: isDark ? darkText : nordicGray,
    },
  })

  return (
    <LiveStoreProvider
      schema={schema}
      renderLoading={(_) => <LoadingLiveStore stage={_.stage} />}
      // disableDevtools={true}
      renderError={(error: any) => (
        <View style={styles.container}>
          <Text style={styles.text}>Error: {JSON.stringify(error, null, 2)}</Text>
        </View>
      )}
      renderShutdown={() => {
        return (
          <View style={styles.container}>
            <Text style={styles.text}>LiveStore Shutdown</Text>
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
              sheetAllowedDetents: [0.4, 0.8],
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
const boot = (store: Store) => {
  if (store.query(tables.users.count()) === 0) {
    store.commit(
      events.userCreated({
        id: nanoid(),
        name: 'Beto',
        email: 'beto@expo.io',
        photoUrl: 'https://avatars.githubusercontent.com/u/43630417?v=4',
      }),
    )
  }
}

export default RootLayout
