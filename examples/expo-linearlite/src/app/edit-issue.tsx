import { queryDb } from '@livestore/livestore'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { IssueStatusIcon, PriorityIcon } from '../components/IssueItem.tsx'
import { ThemedText } from '../components/ThemedText.tsx'
import { useThemeColor } from '../hooks/useThemeColor.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Priority, Status } from '../types.ts'

const EditIssueScreen = () => {
  const issueId = useLocalSearchParams().issueId as string
  const store = useAppStore()
  const router = useRouter()
  const textColor = useThemeColor({}, 'text')

  const issue = store.useQuery(
    queryDb(tables.issues.where({ id: issueId }).first({ behaviour: 'error' }), {
      label: 'edit-issue',
      deps: `edit-issue-${issueId}`,
    }),
  )

  const assignee = store.useQuery(
    queryDb(tables.users.where({ id: issue.assigneeId! }).first({ behaviour: 'error' }), {
      label: 'assignee',
      deps: `edit-issue-assignee-${issue.assigneeId}`,
    }),
  )

  const handleGoBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)')
    }
  }, [router])

  const screenOptions = useMemo(
    () => ({
      headerTitle: `Issue-${issue.id.slice(0, 4)}`,
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
    }),
    [handleGoBack, issue.id],
  )

  const handleTitleChange = useCallback(
    (text: string) => store.commit(events.issueTitleUpdated({ id: issue.id, title: text, updatedAt: new Date() })),
    [issue.id, store],
  )
  const handleDescriptionChange = useCallback(
    (text: string) =>
      store.commit(events.issueDescriptionUpdated({ id: issue.id, description: text, updatedAt: new Date() })),
    [issue.id, store],
  )
  const titleInputStyle = useMemo(() => StyleSheet.compose(styles.titleInput, { color: textColor }), [textColor])
  const descriptionInputStyle = useMemo(
    () => StyleSheet.compose(styles.descriptionInput, { color: textColor }),
    [textColor],
  )
  const assigneeImageSource = useMemo(() => ({ uri: assignee.photoUrl! }), [assignee.photoUrl])

  if (!issueId) {
    return <ThemedText>Issue not found</ThemedText>
  }

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <ScrollView style={styles.container}>
        <View style={styles.contentContainer}>
          <TextInput style={titleInputStyle} value={issue.title} multiline autoFocus onChangeText={handleTitleChange} />

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
              <Image source={assigneeImageSource} style={styles.avatar} />
              <ThemedText style={styles.metadataText}>{assignee.name}</ThemedText>
            </View>
          </View>

          <TextInput
            style={descriptionInputStyle}
            value={issue.description!}
            placeholder="Description..."
            multiline
            onChangeText={handleDescriptionChange}
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
