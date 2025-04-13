import { useClientDocument } from '@livestore/react'
import SegmentedControl from '@react-native-segmented-control/segmented-control'
import { Stack } from 'expo-router'
import React from 'react'
import { ScrollView, View } from 'react-native'

import { RowPropertySwitch } from '@/components/RowPropertySwitch.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { tables } from '@/livestore/schema.ts'

const tabGroupingOptions = ['NoGrouping', 'Assignee', 'Priority', 'Status']
const tabOrderingOptions = ['Priority', 'Last Updated', 'Last Created']
// const completedIssuesOptions = ['None', 'Past Week', 'Past Month', 'Past Year']
const rowProperties = ['Assignee', 'Status', 'Priority']

const FilterSettingsScreen = () => {
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

  return (
    <ScrollView className="flex-1 px-4 py-6 dark:bg-[#18191B]">
      <Stack.Screen
        options={{
          headerTitle: `Filter settings for "${selectedHomeTab}" tab`,
          freezeOnBlur: false,
        }}
      />

      <View className="mb-8">
        <ThemedText className="mb-3">Grouping</ThemedText>
        <SegmentedControl
          values={tabGroupingOptions}
          selectedIndex={tabGroupingOptions.indexOf(
            selectedHomeTab === 'assigned' ? assignedTabGrouping : createdTabGrouping,
          )}
          onChange={(value) =>
            selectedHomeTab === 'assigned'
              ? setUiState({ assignedTabGrouping: value.nativeEvent.value })
              : setUiState({ createdTabGrouping: value.nativeEvent.value })
          }
        />
      </View>

      <View className="mb-8">
        <ThemedText className="mb-3">Ordering</ThemedText>
        <SegmentedControl
          values={tabOrderingOptions}
          selectedIndex={tabOrderingOptions.indexOf(
            selectedHomeTab === 'assigned' ? assignedTabOrdering : createdTabOrdering,
          )}
          onChange={(value) =>
            selectedHomeTab === 'assigned'
              ? setUiState({ assignedTabOrdering: value.nativeEvent.value })
              : setUiState({ createdTabOrdering: value.nativeEvent.value })
          }
        />
      </View>
      <View>
        <ThemedText className="mb-3">Row Properties</ThemedText>
        <View className="flex-row gap-3">
          {rowProperties.map((property) => (
            <RowPropertySwitch
              key={property}
              onPress={() => {
                // TODO re-implement this
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
      {/* <View className="mb-8">
        <ThemedText className="text-lg font-semibold mb-2">
          Completed Issues
        </ThemedText>
        <SegmentedControl
          values={completedIssuesOptions}
          selectedIndex={completedIssuesOptions.indexOf(
            selectedHomeTab === 'assigned'
              ? assignedTabCompletedIssues
              : createdTabCompletedIssues,
          )}
          onChange={(value) =>
            handleUpdateFilter(value.nativeEvent.value, 'tabCompletedIssues')
          }
        />
      </View> */}
    </ScrollView>
  )
}

export default FilterSettingsScreen
