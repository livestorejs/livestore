import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import SegmentedControl from '@react-native-segmented-control/segmented-control'

import { IssueStatusIcon, PriorityIcon } from '@/components/IssueItem.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { useThemeColor } from '@/hooks/useThemeColor.ts'
import type { Priority, Status } from '@/types.ts'

import { events, tables } from '../livestore/schema.ts'

const EditIssueScreen = () => {
  const issueIdParam = useLocalSearchParams().issueId as string
  const issueId = Number(issueIdParam)
  const { store } = useStore()
  const router = useRouter()
  const textColor = useThemeColor({}, 'text')

  const issue = useQuery(
    queryDb(tables.issues.where({ id: issueId }).first({ behaviour: 'error' }), {
      label: 'edit-issue',
      deps: `edit-issue-${issueId}`,
    }),
  )

  

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace({ pathname: '/(tabs)', params: { storeId: store.storeId } })
    }
  }

  if (!Number.isFinite(issueId)) {
    return <ThemedText>Issue not found</ThemedText>
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: `Issue-${String(issue.id).slice(0, 4)}`,
          headerLeft: () => (
            <Pressable onPress={handleGoBack}>
              <ThemedText>Back</ThemedText>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleGoBack}>
              <ThemedText>Done</ThemedText>
            </Pressable>
          ),
          freezeOnBlur: false,
        }}
      />
      <ScrollView style={styles.container}>
        <View style={styles.contentContainer}>
          {/* Title */}
          <TextInput
            style={[styles.titleInput, { color: textColor }]}
            value={issue.title}
            multiline
            autoFocus
            onChangeText={(text: string) =>
              store.commit(events.updateIssueTitle({ id: issue.id, title: text, modified: new Date() }))
            }
          />

          {/* Current metadata preview */}
          <View style={styles.metadataContainer}>
            <View style={styles.metadataItem}>
              <IssueStatusIcon status={issue.status as Status} />
              <ThemedText style={styles.metadataText}>{issue.status}</ThemedText>
            </View>

            <View style={styles.metadataItem}>
              <PriorityIcon priority={issue.priority as Priority} />
              <ThemedText style={styles.metadataText}>{issue.priority}</ThemedText>
            </View>

            <View style={styles.metadataItem}>
              {issue.assigneeName ? (
                <Image
                  source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(issue.assigneeName)}&size=40` }}
                  style={styles.avatar}
                />
              ) : null}
              <ThemedText style={styles.metadataText}>{issue.assigneeName}</ThemedText>
            </View>
          </View>

          {/* Editable status/priority */}
          <View style={styles.segmentGroup}>
            <ThemedText>Status</ThemedText>
            <SegmentedControl
              values={['Backlog', 'Todo', 'In Progress', 'In Review', 'Done']}
              selectedIndex={issue.status as number}
              onChange={(e) =>
                store.commit(
                  events.updateIssueStatus({ id: issue.id, status: e.nativeEvent.selectedSegmentIndex as Status, modified: new Date() }),
                )
              }
            />
          </View>
          <View style={styles.segmentGroup}>
            <ThemedText>Priority</ThemedText>
            <SegmentedControl
              values={['None', 'Low', 'Medium', 'High', 'Urgent']}
              selectedIndex={issue.priority as number}
              onChange={(e) =>
                store.commit(
                  events.updateIssuePriority({ id: issue.id, priority: e.nativeEvent.selectedSegmentIndex as Priority, modified: new Date() }),
                )
              }
            />
          </View>

          <TextInput
            style={[styles.descriptionInput, { color: textColor }]}
            value={issue.description!}
            placeholder="Description..."
            multiline
            onChangeText={(text: string) => store.commit(events.updateDescription({ id: issue.id, body: text }))}
          />
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
  },
  titleInput: {
    fontWeight: 'bold',
    fontSize: 24,
    marginBottom: 12,
  },
  metadataContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    marginVertical: 8,
    borderRadius: 6,
    padding: 4,
    paddingHorizontal: 8,
    gap: 8,
  },
  segmentGroup: {
    gap: 8,
    marginVertical: 8,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metadataText: {
    fontSize: 14,
    fontWeight: '500',
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  descriptionInput: {
    fontWeight: 'normal',
    marginBottom: 12,
  },
})

export default EditIssueScreen
