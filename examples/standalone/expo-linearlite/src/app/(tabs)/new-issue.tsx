import { useRow, useStore } from '@livestore/react'
import { Stack, useRouter } from 'expo-router'
import React, { Fragment } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { useUser } from '@/hooks/useUser.ts'
import { createIssue } from '@/livestore/issues-mutations.ts'
import { updateNewIssueDescription, updateNewIssueText } from '@/livestore/mutations.ts'
import { tables } from '@/livestore/schema.ts'
import { PRIORITIES, STATUSES } from '@/types.ts'

const NewIssueScreen = () => {
  const user = useUser()
  const router = useRouter()
  const { store } = useStore()
  const [{ newIssueText, newIssueDescription }] = useRow(tables.app)

  const handleCreateIssue = () => {
    if (!newIssueText) return

    const id = nanoid()
    store.mutate(
      createIssue({
        id,
        title: newIssueText,
        description: newIssueDescription,
        parentIssueId: null,
        assigneeId: user.id,
        status: STATUSES.BACKLOG,
        priority: PRIORITIES.NONE,
        createdAt: Date.now(),
        updatedAt: null,
      }),
    )
    router.push(`/issue-details?issueId=${id}`)

    // reset state
    store.mutate(updateNewIssueText({ text: '' }))
    store.mutate(updateNewIssueDescription({ text: '' }))
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
          onChangeText={(text: string) => store.mutate(updateNewIssueText({ text }))}
          placeholder="Issue title"
        />
        <TextInput
          value={newIssueDescription}
          onChangeText={(text: string) => store.mutate(updateNewIssueDescription({ text }))}
          className="dark:text-zinc-50"
          placeholder="Description..."
          multiline
        />
      </View>
    </Fragment>
  )
}

export default NewIssueScreen
