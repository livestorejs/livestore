import 'react-native-reanimated'
import '../polyfill.ts'
import { Stack } from 'expo-router'
import { Suspense, useState } from 'react'
import { LogBox, Platform } from 'react-native'

import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'

import { LoadingLiveStore } from '../components/LoadingLiveStore.tsx'
import ThemeProvider from '../context/ThemeProvider.tsx'

LogBox.ignoreAllLogs()

const RootLayout = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <Suspense fallback={<LoadingLiveStore />}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
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
      </StoreRegistryProvider>
    </Suspense>
  )
}

export default RootLayout
