import { queryDb } from '@livestore/livestore'
import { useScopedQuery, useStore } from '@livestore/react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native'

import { IssueStatusIcon, PriorityIcon } from '@/components/IssueItem.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { updateIssueDescription, updateIssueTitle } from '@/livestore/issues-mutations.ts'
import { tables } from '@/livestore/schema.ts'
import type { Priority, Status } from '@/types.ts'

const EditIssueScreen = () => {
  const issueId = useLocalSearchParams().issueId as string
  const { store } = useStore()
  const router = useRouter()

  const issue = useScopedQuery(
    () => queryDb(tables.issues.query.where({ id: issueId }).first(), { label: 'issue' }),
    ['edit-issue', issueId],
  )

  const assignee = useScopedQuery(
    () => queryDb(tables.users.query.where({ id: issue.assigneeId! }).first(), { label: 'assignee' }),
    ['edit-issue-assignee', issue.assigneeId!],
  )

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)')
    }
  }

  if (!issueId) {
    return <ThemedText>Issue not found</ThemedText>
  }

  return (
    <>
      <Stack.Screen
        options={{
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
        }}
      />
      <ScrollView style={{ flex: 1 }}>
        <View className="px-5">
          <TextInput
            className="font-bold text-2xl mb-3 dark:text-zinc-50"
            value={issue.title}
            multiline
            autoFocus
            onChangeText={(text: string) => store.mutate(updateIssueTitle({ id: issue.id, title: text }))}
          />

          <View className="flex-row border my-2 border-zinc-200 dark:border-zinc-700 rounded-md p-1 px-2 gap-2">
            <View className="flex-row items-center gap-2">
              <IssueStatusIcon status={issue.status as Status} />
              <ThemedText style={{ fontSize: 14, fontWeight: '500' }}>{issue.status}</ThemedText>
            </View>

            <View className="flex-row items-center gap-2">
              <PriorityIcon priority={issue.priority as Priority} />
              <ThemedText style={{ fontSize: 14, fontWeight: '500' }}>{issue.priority}</ThemedText>
            </View>

            <View className="flex-row items-center gap-2">
              <Image source={{ uri: assignee.photoUrl! }} className="w-5 h-5 rounded-full" />
              <ThemedText style={{ fontSize: 14, fontWeight: '500' }}>{assignee.name}</ThemedText>
            </View>
          </View>

          <TextInput
            className="font-normal mb-3 dark:text-zinc-50"
            value={issue.description!}
            placeholder="Description..."
            multiline
            onChangeText={(text: string) => store.mutate(updateIssueDescription({ id: issue.id, description: text }))}
          />
        </View>
      </ScrollView>
    </>
  )
}

export default EditIssueScreen
