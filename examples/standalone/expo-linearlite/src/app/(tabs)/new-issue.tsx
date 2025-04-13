import { nanoid } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { Stack, useRouter } from 'expo-router'
import React, { Fragment } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { useUser } from '@/hooks/useUser.ts'
import { uiState$ } from '@/livestore/queries.ts'
import { events } from '@/livestore/schema.ts'
import { PRIORITIES, STATUSES } from '@/types.ts'

const NewIssueScreen = () => {
  const user = useUser()
  const router = useRouter()
  const { store } = useStore()
  const { newIssueText, newIssueDescription } = useQuery(uiState$)

  const handleCreateIssue = () => {
    if (!newIssueText) return

    const id = nanoid()
    store.commit(
      events.issueCreated({
        id,
        title: newIssueText,
        description: newIssueDescription,
        parentIssueId: null,
        assigneeId: user.id,
        status: STATUSES.BACKLOG,
        priority: PRIORITIES.NONE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      // reset state
      events.uiStateSet({ newIssueText: '', newIssueDescription: '' }),
    )
    router.push(`/issue-details?issueId=${id}`)
  }

  return (
    <Fragment>
      <Stack.Screen
        options={{
          title: 'New Issue',
          headerRight: () => (
            <Pressable onPress={handleCreateIssue}>
              <Text className="text-blue-500 pr-4">Create</Text>
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.back()}>
              <Text className="text-blue-500 pl-4">Cancel</Text>
            </Pressable>
          ),
          freezeOnBlur: false,
        }}
      />
      <View className="px-5 pt-3">
        <TextInput
          value={newIssueText}
          className="font-bold text-2xl mb-3 dark:text-zinc-50"
          onChangeText={(text: string) => store.commit(events.uiStateSet({ newIssueText: text }))}
          placeholder="Issue title"
        />
        <TextInput
          value={newIssueDescription}
          onChangeText={(text: string) => store.commit(events.uiStateSet({ newIssueDescription: text }))}
          className="dark:text-zinc-50"
          placeholder="Description..."
          multiline
        />
      </View>
    </Fragment>
  )
}

export default NewIssueScreen
