import '../../polyfill.ts'
import { Tabs, useRouter } from 'expo-router'
import { HouseIcon, InboxIcon, SearchIcon, SettingsIcon, SlidersHorizontal, SquarePen } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { Pressable } from 'react-native'

// export const unstable_settings = {
//   // Ensure any route can link back to `/`
//   initialRouteName: '/',
// };

const TabLayout = () => {
  const router = useRouter()
  const handleOpenFilterSettings = useCallback(() => router.push('/filter-settings'), [router])

  const indexOptions = useMemo(
    () => ({
      tabBarIcon: HomeTabBarIcon,
      headerTitle: 'Expo',
      headerTitleAlign: 'left' as const,
      headerStyle: styles.headerStyle,
      headerTitleStyle: styles.headerTitleStyle,
      headerRight: () => (
        <Pressable style={styles.filterButton} onPress={handleOpenFilterSettings}>
          <SlidersHorizontal color={'gray'} size={18} />
        </Pressable>
      ),
    }),
    [handleOpenFilterSettings],
  )

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={indexOptions} />
      <Tabs.Screen name="inbox" options={inboxOptions} />
      <Tabs.Screen name="new-issue" options={newIssueOptions} />
      <Tabs.Screen name="search" options={searchOptions} />
      <Tabs.Screen name="settings" options={settingsOptions} />
    </Tabs>
  )
}

export default TabLayout

const screenOptions = {
  tabBarShowLabel: false,
  freezeOnBlur: false,
}

const HomeTabBarIcon = ({ color, size }: { color: string; size: number }) => <HouseIcon color={color} size={size} />
const InboxTabBarIcon = ({ color, size }: { color: string; size: number }) => <InboxIcon color={color} size={size} />
const NewIssueTabBarIcon = ({ color, size }: { color: string; size: number }) => <SquarePen color={color} size={size} />
const SearchTabBarIcon = ({ color, size }: { color: string; size: number }) => <SearchIcon color={color} size={size} />
const SettingsTabBarIcon = ({ color, size }: { color: string; size: number }) => (
  <SettingsIcon color={color} size={size} />
)

const inboxOptions = {
  tabBarIcon: InboxTabBarIcon,
}

const newIssueOptions = {
  tabBarIcon: NewIssueTabBarIcon,
}

const searchOptions = {
  tabBarIcon: SearchTabBarIcon,
  headerShown: false,
}

const settingsOptions = {
  tabBarIcon: SettingsTabBarIcon,
  headerShown: false,
}

const styles = {
  headerStyle: {
    shadowColor: 'transparent',
  },
  headerTitleStyle: {
    fontSize: 12,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
    color: 'gray',
  },
  filterButton: {
    marginRight: 16,
    padding: 8,
  },
}
