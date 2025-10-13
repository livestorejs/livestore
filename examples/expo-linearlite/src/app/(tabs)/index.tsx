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
  const rawGrouping = tab === 'assigned' ? assignedTabGrouping : createdTabGrouping
  const rawOrdering = tab === 'assigned' ? assignedTabOrdering : createdTabOrdering

  const grouping = (rawGrouping ?? '').toLowerCase()
  const ordering = (rawOrdering ?? '').toLowerCase()

  let orderClause = 'ORDER BY '
  const orderFields: string[] = []

  // Grouping (normalized)
  if (grouping && grouping !== 'nogrouping') {
    const groupingField =
      grouping === 'assignee'
        ? 'assigneeId ASC'
        : grouping === 'priority'
          ? 'issues.priority DESC'
          : grouping === 'status'
            ? 'issues.status ASC'
            : ''
    if (groupingField) orderFields.push(groupingField)
  }

  // Ordering (normalized)
  if (ordering) {
    const orderingField =
      ordering === 'priority'
        ? 'issues.priority DESC'
        : ordering === 'last updated'
          ? 'issues.updatedAt DESC'
          : ordering === 'last created'
            ? 'issues.createdAt DESC'
            : ''
    if (orderingField) orderFields.push(orderingField)
  }

  // Default
  if (orderFields.length === 0) orderFields.push('issues.createdAt DESC')

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
  const { selectedHomeTab, assignedTabGrouping, assignedTabOrdering, createdTabGrouping, createdTabOrdering } = useMemo(
    () => ({
      selectedHomeTab: appSettings.selectedHomeTab,
      assignedTabGrouping: appSettings.assignedTabGrouping,
      assignedTabOrdering: appSettings.assignedTabOrdering,
      createdTabGrouping: appSettings.createdTabGrouping,
      createdTabOrdering: appSettings.createdTabOrdering,
    }),
    [appSettings],
  )

  // Counts for segment labels
  const allCount = useQuery(
    queryDb(tables.issues.count().where({ deletedAt: null }), { label: 'home-count-all', deps: ['issues'] }),
  )
  const assignedCount = useQuery(
    queryDb(tables.issues.count().where({ deletedAt: null, assigneeId: user.id }), {
      label: 'home-count-assigned',
      deps: ['issues', user.id],
    }),
  )
  const createdCount = useQuery(
    queryDb(tables.issues.count().where({ deletedAt: null, assigneeId: user.id }), {
      label: 'home-count-created',
      deps: ['issues', user.id],
    }),
  )

  // Memoize display settings separately
  const displaySettings = useMemo(
    () => ({
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
            SELECT issues.title, issues.id, issues.assigneeId, issues.assigneeName, issues.status, issues.priority
            FROM issues 
            WHERE issues.deletedAt IS NULL 
            AND (
              ${
                selectedHomeTab === 'assigned'
                  ? `issues.assigneeId = '${user.id}'`
                  : selectedHomeTab === 'created'
                    ? `issues.assigneeId = '${user.id}'`
                    : `true`
              }
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
          Schema.pick('title', 'id', 'assigneeId', 'assigneeName', 'status', 'priority'),
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
              store.commit(events.uiStateSet({ selectedHomeTab: 'all' }))
            }}
            style={[styles.tabButton, isDark && styles.tabButtonDark, { opacity: selectedHomeTab === 'all' ? 1 : 0.5 }]}
          >
            <ThemedText style={styles.tabText} type="defaultSemiBold">
              All ({allCount})
            </ThemedText>
          </Pressable>
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
              Assigned ({assignedCount})
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
              Created ({createdCount})
            </ThemedText>
          </Pressable>
        </View>
      </View>
    ),
    [selectedHomeTab, store, isDark, allCount, assignedCount, createdCount],
  )

  return (
    <FlatList
      data={issues}
      renderItem={renderItem}
      initialNumToRender={30}
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
