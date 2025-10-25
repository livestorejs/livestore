import 'react-native-reanimated'
import '../polyfill.ts'

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

import { LoadingLiveStore } from '../components/LoadingLiveStore.tsx'
import { darkBackground, darkText, nordicGray } from '../constants/Colors.ts'
import ThemeProvider from '../context/ThemeProvider.tsx'

import { events, schema, tables } from '../livestore/schema.ts'

LogBox.ignoreAllLogs()

const adapter = makePersistedAdapter({})

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

const RootLayout = () => {
  const [, rerender] = React.useState({})
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isDark ? darkBackground : 'white',
        },
        text: {
          color: isDark ? darkText : nordicGray,
        },
      }),
    [isDark],
  )

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      boot={boot}
      renderLoading={(_) => <LoadingLiveStore stage={_.stage} />}
      renderError={(error) => (
        <View style={styles.container}>
          <Text style={styles.text}>Error: {JSON.stringify(error, null, 2)}</Text>
        </View>
      )}
      renderShutdown={() => (
        <View style={styles.container}>
          <Text style={styles.text}>LiveStore Shutdown</Text>
          <Button title="Reload" onPress={() => rerender({})} />
        </View>
      )}
      batchUpdates={batchUpdates}
      // disableDevtools={true}
    >
      <ThemeProvider>
        <Stack screenOptions={{ freezeOnBlur: true }}>
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

export default RootLayout
