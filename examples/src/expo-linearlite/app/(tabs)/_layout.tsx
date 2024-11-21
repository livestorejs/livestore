import '../../global.css'
import '../../globals.js'
import '../../polyfill.ts'

import { Tabs, useRouter } from 'expo-router'
import { HouseIcon, InboxIcon, SearchIcon, SettingsIcon, SlidersHorizontal, SquarePen } from 'lucide-react-native'
import { Pressable, TouchableOpacity } from 'react-native'

// export const unstable_settings = {
//   // Ensure any route can link back to `/`
//   initialRouteName: '/',
// };

export default function TabLayout() {
  const router = useRouter()
  return (
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
          headerTitle: 'Expo',
          headerTitleAlign: 'left',
          headerStyle: { shadowColor: 'transparent' },
          headerTitleStyle: {
            fontSize: 12,
            fontWeight: '500',
            letterSpacing: 0.3,
            color: 'gray',
          },
          headerRight: () => (
            <Pressable className="p-3" style={{ marginRight: 16 }} onPress={() => router.push('/filter-settings')}>
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
  )
}
