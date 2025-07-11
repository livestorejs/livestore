import { useClientDocument } from '@livestore/react'
import SegmentedControl from '@react-native-segmented-control/segmented-control'
import { Stack } from 'expo-router'
import { ScrollView, StyleSheet, useColorScheme, View } from 'react-native'

import { RowPropertySwitch } from '@/components/RowPropertySwitch.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { darkSecondary } from '@/constants/Colors.ts'
import { tables } from '@/livestore/schema.ts'

const tabGroupingOptions = ['NoGrouping', 'Assignee', 'Priority', 'Status']
const tabOrderingOptions = ['Priority', 'Last Updated', 'Last Created']
// const completedIssuesOptions = ['None', 'Past Week', 'Past Month', 'Past Year']
const rowProperties = ['Assignee', 'Status', 'Priority']

const FilterSettingsScreen = () => {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

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
  ] = useClientDocument(tables.uiState)

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 16,
      paddingVertical: 24,
      backgroundColor: isDark ? darkSecondary : 'white',
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

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: `Filter settings for "${selectedHomeTab}" tab`,
          freezeOnBlur: false,
        }}
      />

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Grouping</ThemedText>
        <SegmentedControl
          values={tabGroupingOptions}
          selectedIndex={tabGroupingOptions.indexOf(
            selectedHomeTab === 'assigned' ? assignedTabGrouping : createdTabGrouping,
          )}
          onChange={(value) =>
            selectedHomeTab === 'assigned'
              ? setUiState({ assignedTabGrouping: value.nativeEvent.value.toLowerCase() })
              : setUiState({ createdTabGrouping: value.nativeEvent.value.toLowerCase() })
          }
        />
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>Ordering</ThemedText>
        <SegmentedControl
          values={tabOrderingOptions}
          selectedIndex={tabOrderingOptions.indexOf(
            selectedHomeTab === 'assigned' ? assignedTabOrdering : createdTabOrdering,
          )}
          onChange={(value) =>
            selectedHomeTab === 'assigned'
              ? setUiState({ assignedTabOrdering: value.nativeEvent.value.toLowerCase() })
              : setUiState({ createdTabOrdering: value.nativeEvent.value.toLowerCase() })
          }
        />
      </View>
      <View>
        <ThemedText style={styles.sectionTitle}>Row Properties</ThemedText>
        <View style={styles.rowPropertiesContainer}>
          {rowProperties.map((property) => (
            <RowPropertySwitch
              key={property}
              onPress={() => {
                const settingKey = `${selectedHomeTab}TabShow${property}`
                const currentValue =
                  selectedHomeTab === 'assigned'
                    ? property === 'Assignee'
                      ? assignedTabShowAssignee
                      : property === 'Status'
                        ? assignedTabShowStatus
                        : assignedTabShowPriority
                    : property === 'Assignee'
                      ? createdTabShowAssignee
                      : property === 'Status'
                        ? createdTabShowStatus
                        : createdTabShowPriority

                setUiState({
                  [settingKey]: !currentValue,
                })
              }}
              label={property}
              isSelected={
                selectedHomeTab === 'assigned'
                  ? property === 'Assignee'
                    ? assignedTabShowAssignee
                    : property === 'Status'
                      ? assignedTabShowStatus
                      : assignedTabShowPriority
                  : property === 'Assignee'
                    ? createdTabShowAssignee
                    : property === 'Status'
                      ? createdTabShowStatus
                      : createdTabShowPriority
              }
            />
          ))}
        </View>
      </View>
    </ScrollView>
  )
}

export default FilterSettingsScreen
