import 'react-native-reanimated'
import '../polyfill.ts'

import { makePersistedAdapter } from '@livestore/adapter-expo'
import type { Store } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/react'
import { makeWsSync } from '@livestore/sync-cf/client'
import { Stack, useGlobalSearchParams } from 'expo-router'
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
import ThemeProvider from '@/context/ThemeProvider.tsx'

import { events, schema, tables } from '../livestore/schema.ts'

LogBox.ignoreAllLogs()

// Read storeId intent from global search params when present
const getInitialStoreId = () => process.env.EXPO_PUBLIC_LIVESTORE_STORE_ID ?? 'default'
const syncUrl = process.env.EXPO_PUBLIC_LIVESTORE_SYNC_URL

const adapter = makePersistedAdapter({
  sync: { backend: syncUrl ? makeWsSync({ url: syncUrl }) : undefined },
  // resetPersistence: true,
})

const randomFunnyName = () => {
  const left = ['Witty', 'Cheeky', 'Curious', 'Brave', 'Sleepy', 'Zesty', 'Quirky', 'Fuzzy', 'Sneaky']
  const right = ['Sloth', 'Panda', 'Otter', 'Llama', 'Koala', 'Gopher', 'Duck', 'Yak', 'Capybara']
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]!
  return `${pick(left)} ${pick(right)}`
}

const boot = (store: Store) => {
  const ui = store.query(tables.uiState.get())
  const currentName = (ui.currentUserName ?? '').trim()
  const currentId = (ui.currentUserId ?? '').trim()
  if (currentName === '' || currentId === '') {
    const name = currentName || randomFunnyName()
    const id = (currentId || name)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    store.commit(events.uiStateSet({ currentUserName: name, currentUserId: id }))
  }
}

const RootLayout = () => {
  const [, rerender] = React.useState({})
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const syncPayload = React.useMemo(() => ({ authToken: 'insecure-token-change-me' }), [])

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

  // Keep a sticky storeId in component state rather than a module-global
  const params = useGlobalSearchParams<{ storeId?: string | string[] }>()
  const [selectedStoreId, setSelectedStoreId] = React.useState<string>(() => getInitialStoreId())

  React.useEffect(() => {
    const raw = Array.isArray(params.storeId) ? params.storeId[0] : params.storeId
    const v = raw?.trim()
    if (v && v.length > 0 && v !== selectedStoreId) setSelectedStoreId(v)
  }, [params.storeId, selectedStoreId])

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      boot={boot}
      storeId={selectedStoreId}
      syncPayload={syncPayload}
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
