import '../../polyfill.ts'

import { useStore } from '@livestore/react'
import { Tabs, useRouter } from 'expo-router'
import { HouseIcon, InboxIcon, SearchIcon, SettingsIcon, SlidersHorizontal, SquarePen } from 'lucide-react-native'
import React from 'react'
import { Keyboard, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { Modal } from '@/components/Modal.tsx'
import { useUser } from '@/hooks/useUser.ts'
import { events } from '@/livestore/schema.ts'

// export const unstable_settings = {
//   // Ensure any route can link back to `/`
//   initialRouteName: '/',
// };

const TabLayout = () => {
  const router = useRouter()
  const { store } = useStore()
  const user = useUser()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const [switcherOpen, setSwitcherOpen] = React.useState(false)
  const [nextStoreId, setNextStoreId] = React.useState<string>(store.storeId)
  const [nextUserName, setNextUserName] = React.useState<string>(user.name)

  const openSwitcher = React.useCallback(() => {
    setNextStoreId(store.storeId)
    setNextUserName(user.name)
    setSwitcherOpen(true)
  }, [store.storeId, user.name])

  const onConfirmSwitch = React.useCallback(() => {
    const trimmedStore = nextStoreId.trim()
    const trimmedUser = nextUserName.trim()
    setSwitcherOpen(false)
    if (trimmedUser.length > 0 && trimmedUser !== user.name) {
      const id = trimmedUser
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
      store.commit(events.uiStateSet({ currentUserName: trimmedUser, currentUserId: id }))
    }
    if (trimmedStore.length > 0 && trimmedStore !== store.storeId) {
      router.setParams({ storeId: trimmedStore })
    }
  }, [nextStoreId, nextUserName, router, store, user.name])

  const headerTitleStyle = React.useMemo(
    () => ({ fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.3, color: 'gray' as const }),
    [],
  )

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarShowLabel: false,
          freezeOnBlur: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            tabBarIcon: ({ color, size }) => <HouseIcon color={color} size={size} />,
            headerTitle: () => (
              <Pressable accessibilityRole="button" onPress={openSwitcher} hitSlop={8}>
                <Text style={headerTitleStyle}>
                  {store.storeId} · {user.name}
                </Text>
              </Pressable>
            ),
            headerTitleAlign: 'left',
            headerStyle: { shadowColor: 'transparent' },
            headerTitleStyle,
            headerRight: () => (
              <Pressable
                style={{ marginRight: 16, padding: 8 }}
                onPress={() => router.push({ pathname: '/filter-settings', params: { storeId: store.storeId } })}
              >
                <SlidersHorizontal color={'gray'} size={18} />
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            tabBarIcon: ({ color, size }) => <InboxIcon color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="new-issue"
          options={{
            tabBarIcon: ({ color, size }) => <SquarePen color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            tabBarIcon: ({ color, size }) => <SearchIcon color={color} size={size} />,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            tabBarIcon: ({ color, size }) => <SettingsIcon color={color} size={size} />,
            headerShown: false,
          }}
        />
      </Tabs>
      {/* Store switcher modal (must be outside <Tabs> children) */}
      <Modal visible={switcherOpen} onClose={() => setSwitcherOpen(false)}>
        <View style={styles.switcherContainer}>
          <Text style={[styles.switcherTitle, { color: isDark ? '#e5e7eb' : '#111827' }]}>Store & User</Text>
          <TextInput
            value={nextStoreId}
            onChangeText={setNextStoreId}
            placeholder="Enter new store ID"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => {
              onConfirmSwitch()
              Keyboard.dismiss()
            }}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Enter') onConfirmSwitch()
            }}
            autoFocus
            style={[
              styles.input,
              { borderColor: isDark ? '#374151' : '#e5e7eb', color: isDark ? '#e5e7eb' : '#111827' },
            ]}
            placeholderTextColor={isDark ? '#6b7280' : '#9ca3af'}
          />
          <TextInput
            value={nextUserName}
            onChangeText={setNextUserName}
            placeholder="Enter display name"
            autoCapitalize="words"
            autoCorrect
            returnKeyType="done"
            onSubmitEditing={() => {
              onConfirmSwitch()
              Keyboard.dismiss()
            }}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Enter') onConfirmSwitch()
            }}
            style={[
              styles.input,
              { borderColor: isDark ? '#374151' : '#e5e7eb', color: isDark ? '#e5e7eb' : '#111827' },
            ]}
            placeholderTextColor={isDark ? '#6b7280' : '#9ca3af'}
          />
          <View style={styles.switcherActions}>
            <Pressable onPress={() => setSwitcherOpen(false)} style={[styles.button, styles.cancelButton]}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onConfirmSwitch} style={[styles.button, styles.primaryButton]}>
              <Text style={[styles.buttonText, styles.primaryButtonText]}>Switch</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  )
}

export default TabLayout

const styles = StyleSheet.create({
  switcherContainer: { gap: 12 },
  switcherTitle: { fontSize: 16, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  switcherActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  cancelButton: { backgroundColor: 'transparent' },
  primaryButton: { backgroundColor: '#2563eb' },
  buttonText: { fontSize: 14 },
  primaryButtonText: { color: 'white', fontWeight: '600' },
})
