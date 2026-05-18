import SegmentedControl from '@react-native-segmented-control/segmented-control'
import { Stack } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { ScrollView, StyleSheet, useColorScheme, View } from 'react-native'

import { RowPropertySwitch } from '../components/RowPropertySwitch.tsx'
import { ThemedText } from '../components/ThemedText.tsx'
import { darkSecondary } from '../constants/Colors.ts'
import { tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const tabGroupingOptions = ['NoGrouping', 'Assignee', 'Priority', 'Status']
const tabOrderingOptions = ['Priority', 'Last Updated', 'Last Created']
// const completedIssuesOptions = ['None', 'Past Week', 'Past Month', 'Past Year']
const rowProperties = ['Assignee', 'Status', 'Priority'] as const
type RowProperty = (typeof rowProperties)[number]

const FilterSettingsScreen = () => {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const store = useAppStore()
  const [
    {
      selectedHomeTab,
      assignedTabGrouping,
      assignedTabOrdering,
      // assignedTabCompletedIssues,
      assignedTabShowAssignee,
      assignedTabShowStatus,
      assignedTabShowPriority,
      createdTabGrouping,
      createdTabOrdering,
      // createdTabCompletedIssues,
      createdTabShowAssignee,
      createdTabShowStatus,
      createdTabShowPriority,
    },
    setUiState,
  ] = store.useClientDocument(tables.uiState)

  const containerStyle = useMemo(
    () => StyleSheet.compose(styles.container, isDark ? styles.containerDark : styles.containerLight),
    [isDark],
  )
  const selectedGrouping = selectedHomeTab === 'assigned' ? assignedTabGrouping : createdTabGrouping
  const selectedOrdering = selectedHomeTab === 'assigned' ? assignedTabOrdering : createdTabOrdering
  const screenOptions = useMemo(
    () => ({
      headerTitle: `Filter settings for "${selectedHomeTab}" tab`,
      freezeOnBlur: false,
    }),
    [selectedHomeTab],
  )

  const onGroupingChange = useCallback(
    (value: { nativeEvent: { value: string } }) => {
      const nextValue = value.nativeEvent.value.toLowerCase()
      if (selectedHomeTab === 'assigned') {
        setUiState({ assignedTabGrouping: nextValue })
        return
      }
      setUiState({ createdTabGrouping: nextValue })
    },
    [selectedHomeTab, setUiState],
  )

  const onOrderingChange = useCallback(
    (value: { nativeEvent: { value: string } }) => {
      const nextValue = value.nativeEvent.value.toLowerCase()
      if (selectedHomeTab === 'assigned') {
        setUiState({ assignedTabOrdering: nextValue })
        return
      }
      setUiState({ createdTabOrdering: nextValue })
    },
    [selectedHomeTab, setUiState],
  )

  const toggleAssignee = useCallback(() => {
    const currentValue = selectedHomeTab === 'assigned' ? assignedTabShowAssignee : createdTabShowAssignee
    setUiState({ [`${selectedHomeTab}TabShowAssignee`]: !currentValue })
  }, [assignedTabShowAssignee, createdTabShowAssignee, selectedHomeTab, setUiState])

  const toggleStatus = useCallback(() => {
    const currentValue = selectedHomeTab === 'assigned' ? assignedTabShowStatus : createdTabShowStatus
    setUiState({ [`${selectedHomeTab}TabShowStatus`]: !currentValue })
  }, [assignedTabShowStatus, createdTabShowStatus, selectedHomeTab, setUiState])

  const togglePriority = useCallback(() => {
    const currentValue = selectedHomeTab === 'assigned' ? assignedTabShowPriority : createdTabShowPriority
    setUiState({ [`${selectedHomeTab}TabShowPriority`]: !currentValue })
  }, [assignedTabShowPriority, createdTabShowPriority, selectedHomeTab, setUiState])

  const rowPropertyStates = useMemo(
    () => ({
      Assignee: selectedHomeTab === 'assigned' ? assignedTabShowAssignee : createdTabShowAssignee,
      Status: selectedHomeTab === 'assigned' ? assignedTabShowStatus : createdTabShowStatus,
      Priority: selectedHomeTab === 'assigned' ? assignedTabShowPriority : createdTabShowPriority,
    }),
    [
      assignedTabShowAssignee,
      assignedTabShowPriority,
      assignedTabShowStatus,
      createdTabShowAssignee,
      createdTabShowPriority,
      createdTabShowStatus,
      selectedHomeTab,
    ],
  )

  const rowPropertyHandlers = useMemo<Record<RowProperty, () => void>>(
    () => ({
      Assignee: toggleAssignee,
      Status: toggleStatus,
      Priority: togglePriority,
    }),
    [toggleAssignee, togglePriority, toggleStatus],
  )

  return (
    <ScrollView style={containerStyle}>
      <Stack.Screen options={screenOptions} />

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Grouping</ThemedText>
        <SegmentedControl
          values={tabGroupingOptions}
          selectedIndex={tabGroupingOptions.indexOf(selectedGrouping)}
          onChange={onGroupingChange}
        />
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Ordering</ThemedText>
        <SegmentedControl
          values={tabOrderingOptions}
          selectedIndex={tabOrderingOptions.indexOf(selectedOrdering)}
          onChange={onOrderingChange}
        />
      </View>
      <View>
        <ThemedText style={styles.sectionTitle}>Row Properties</ThemedText>
        <View style={styles.rowPropertiesContainer}>
          {rowProperties.map((property) => (
            <RowPropertySwitch
              key={property}
              onPress={rowPropertyHandlers[property]}
              label={property}
              isSelected={rowPropertyStates[property]}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  )
}

export default FilterSettingsScreen

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  containerDark: {
    backgroundColor: darkSecondary,
  },
  containerLight: {
    backgroundColor: 'white',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  rowPropertiesContainer: {
    flexDirection: 'row',
    gap: 12,
  },
})
