import 'react-native-reanimated'
import '../polyfill.ts'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import { Stack } from 'expo-router'
import { Suspense, useMemo, useState } from 'react'
import { LogBox, Platform } from 'react-native'

import { LoadingLiveStore } from '../components/LoadingLiveStore.tsx'
import ThemeProvider from '../context/ThemeProvider.tsx'

const loadingLiveStoreFallback = <LoadingLiveStore />
const rootStackScreenOptions = { freezeOnBlur: true }
const tabsScreenOptions = { headerShown: false }
const issueDetailsScreenOptions = {
  freezeOnBlur: false,
  headerShadowVisible: false,
}
const editIssueScreenOptions = { presentation: 'modal' as const, freezeOnBlur: false }

LogBox.ignoreAllLogs()

const RootLayout = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())
  const filterSettingsScreenOptions = useMemo(
    () => ({
      presentation: Platform.OS === 'ios' ? ('formSheet' as const) : ('modal' as const),
      sheetAllowedDetents: [0.4, 0.8],
      sheetCornerRadius: 16,
      sheetGrabberVisible: true,
      headerShown: Platform.OS === 'android',
    }),
    [],
  )

  return (
    <Suspense fallback={loadingLiveStoreFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <ThemeProvider>
          <Stack screenOptions={rootStackScreenOptions}>
            <Stack.Screen name="(tabs)" options={tabsScreenOptions} />
            <Stack.Screen name="filter-settings" options={filterSettingsScreenOptions} />
            <Stack.Screen name="issue-details" options={issueDetailsScreenOptions} />
            <Stack.Screen name="edit-issue" options={editIssueScreenOptions} />
          </Stack>
        </ThemeProvider>
      </StoreRegistryProvider>
    </Suspense>
  )
}

export default RootLayout
