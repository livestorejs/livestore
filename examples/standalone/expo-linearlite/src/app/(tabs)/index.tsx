import { queryDb, Schema, sql } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import * as Haptics from 'expo-haptics'
import { useCallback, useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, useColorScheme, View } from 'react-native'

import { IssueItem } from '@/components/IssueItem.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { useUser } from '@/hooks/useUser.ts'
import { uiState$ } from '@/livestore/queries.ts'

import { events, tables } from '../../livestore/schema.ts'

// const homeTabs = ['Assigned', 'Created']
// For reference
// const tabGroupingOptions = ['NoGrouping', 'Assignee', 'Priority', 'Status'];
// const tabOrderingOptions = ['Priority', 'Last Updated', 'Last Created'];
// const completedIssuesOptions = ['None', 'Past Week', 'Past Month', 'Past Year'];

const getOrderingOptions = (
  tab: string,
  assignedTabGrouping: string,
  assignedTabOrdering: string,
  createdTabGrouping: string,
  createdTabOrdering: string,
) => {
  const grouping = tab === 'Assigned' ? assignedTabGrouping : createdTabGrouping
  const ordering = tab === 'Assigned' ? assignedTabOrdering : createdTabOrdering

  let orderClause = 'ORDER BY '
  const orderFields = []

  // Handle grouping
  if (grouping !== 'NoGrouping') {
    const groupingField =
      grouping === 'Assignee'
        ? 'assigneeId ASC'
        : grouping === 'Priority'
          ? `CASE issues.priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              WHEN 'none' THEN 5
              ELSE 6
            END ASC`
          : grouping === 'Status'
            ? `CASE issues.status
                WHEN 'triage' THEN 1
                WHEN 'backlog' THEN 2
                WHEN 'todo' THEN 3
                WHEN 'in_progress' THEN 4
                WHEN 'in_review' THEN 5
                WHEN 'done' THEN 6
                WHEN 'canceled' THEN 7
                WHEN 'wont_fix' THEN 8
                WHEN 'auto_closed' THEN 9
                ELSE 10
              END ASC`
            : ''
    if (groupingField) {
      orderFields.push(groupingField)
    }
  }

  // Handle ordering
  if (ordering) {
    const orderingField =
      ordering === 'Priority'
        ? `CASE issues.priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              WHEN 'none' THEN 5
              ELSE 6
            END ASC`
        : ordering === 'Last Updated'
          ? 'issues.updatedAt DESC'
          : ordering === 'Last Created'
            ? 'issues.createdAt DESC'
            : ''
    if (orderingField) {
      orderFields.push(orderingField)
    }
  }

  // If no grouping or ordering specified, default to 'createdAt DESC'
  if (orderFields.length === 0) {
    orderFields.push('issues.createdAt DESC')
  }

  orderClause += orderFields.join(', ')
  return orderClause
}

const HomeScreen = () => {
  const user = useUser()
  const { store } = useStore()
  const appSettings = useQuery(uiState$)
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  // Memoize selected settings
  const {
    selectedHomeTab,
    assignedTabGrouping,
    assignedTabOrdering,
    createdTabGrouping,
    createdTabOrdering,
    ...displaySettings
  } = useMemo(
    () => ({
      selectedHomeTab: appSettings.selectedHomeTab,
      assignedTabGrouping: appSettings.assignedTabGrouping,
      assignedTabOrdering: appSettings.assignedTabOrdering,
      createdTabGrouping: appSettings.createdTabGrouping,
      createdTabOrdering: appSettings.createdTabOrdering,
      assignedTabShowAssignee: appSettings.assignedTabShowAssignee,
      assignedTabShowStatus: appSettings.assignedTabShowStatus,
      assignedTabShowPriority: appSettings.assignedTabShowPriority,
      createdTabShowAssignee: appSettings.createdTabShowAssignee,
      createdTabShowStatus: appSettings.createdTabShowStatus,
      createdTabShowPriority: appSettings.createdTabShowPriority,
    }),
    [appSettings],
  )

  const issues = useQuery(
    queryDb(
      {
        query: sql`
            SELECT issues.title, issues.id, issues.assigneeId, issues.status, issues.priority, users.photoUrl as assigneePhotoUrl
            FROM issues 
            LEFT JOIN users ON issues.assigneeId = users.id
            WHERE issues.deletedAt IS NULL 
            AND (
              ${selectedHomeTab === 'assigned' ? `issues.assigneeId = '${user.id}'` : `true`}
            )
            ${getOrderingOptions(
              selectedHomeTab,
              assignedTabGrouping,
              assignedTabOrdering,
              createdTabGrouping,
              createdTabOrdering,
            )}
            LIMIT 50
          `,
        schema: tables.issues.rowSchema.pipe(
          Schema.pick('title', 'id', 'assigneeId', 'status', 'priority'),
          Schema.extend(Schema.Struct({ assigneePhotoUrl: Schema.String })),
          Schema.Array,
        ),
      },
      {
        label: `issues-${selectedHomeTab}-${user.id}`,
        deps: [
          'issues',
          selectedHomeTab,
          user.id,
          assignedTabGrouping,
          assignedTabOrdering,
          createdTabGrouping,
          createdTabOrdering,
        ],
      },
    ),
  )

  // Memoize the renderItem function
  const renderItem = useCallback(
    ({ item }: { item: (typeof issues)[number] }) => (
      <IssueItem
        issue={item}
        showAssignee={
          selectedHomeTab === 'assigned'
            ? displaySettings.assignedTabShowAssignee
            : displaySettings.createdTabShowAssignee
        }
        showStatus={
          selectedHomeTab === 'assigned' ? displaySettings.assignedTabShowStatus : displaySettings.createdTabShowStatus
        }
        showPriority={
          selectedHomeTab === 'assigned'
            ? displaySettings.assignedTabShowPriority
            : displaySettings.createdTabShowPriority
        }
      />
    ),
    [selectedHomeTab, displaySettings],
  )

  // Memoize the header component
  const ListHeaderComponent = useMemo(
    () => (
      <View style={[styles.headerContainer, isDark && styles.headerContainerDark]}>
        <View style={styles.tabContainer}>
          <Pressable
            onPressIn={async () => {
              await Haptics.selectionAsync()
              store.commit(events.uiStateSet({ selectedHomeTab: 'assigned' }))
            }}
            style={[
              styles.tabButton,
              isDark && styles.tabButtonDark,
              { opacity: selectedHomeTab === 'assigned' ? 1 : 0.5 },
            ]}
          >
            <ThemedText style={styles.tabText} type="defaultSemiBold">
              Assigned
            </ThemedText>
          </Pressable>
          <Pressable
            onPressIn={async () => {
              await Haptics.selectionAsync()
              store.commit(events.uiStateSet({ selectedHomeTab: 'created' }))
            }}
            style={[
              styles.tabButton,
              isDark && styles.tabButtonDark,
              { opacity: selectedHomeTab === 'created' ? 1 : 0.5 },
            ]}
          >
            <ThemedText style={styles.tabText} type="defaultSemiBold">
              Created
            </ThemedText>
          </Pressable>
        </View>
      </View>
    ),
    [selectedHomeTab, store, isDark],
  )

  return (
    <FlatList
      data={issues}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      keyExtractor={(item) => item.id.toString()}
      ListHeaderComponent={ListHeaderComponent}
    />
  )
}

const styles = StyleSheet.create({
  headerContainer: {
    paddingHorizontal: 12,
    backgroundColor: 'white',
  },
  headerContainerDark: {
    backgroundColor: '#0C0D0D',
  },
  tabContainer: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 12,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#e4e4e7', // zinc-200
  },
  tabButtonDark: {
    backgroundColor: '#27272a', // zinc-800
  },
  tabText: {
    textAlign: 'center',
  },
  listContent: {
    gap: 1,
    paddingHorizontal: 2,
  },
})

export default HomeScreen
