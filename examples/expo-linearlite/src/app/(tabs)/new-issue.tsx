import { nanoid } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { Stack, useRouter } from 'expo-router'
import { Fragment } from 'react'
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { useUser } from '@/hooks/useUser.ts'
import { uiState$ } from '@/livestore/queries.ts'
import { events } from '@/livestore/schema.ts'
import { PRIORITIES, STATUSES } from '@/types.ts'

const NewIssueScreen = () => {
  const user = useUser()
  const router = useRouter()
  const { store } = useStore()
  const { newIssueText, newIssueDescription } = useQuery(uiState$)
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

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
              <Text style={styles.actionButton}>Create</Text>
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.back()}>
              <Text style={styles.actionButton}>Cancel</Text>
            </Pressable>
          ),
          freezeOnBlur: false,
        }}
      />
      <View style={styles.container}>
        <TextInput
          value={newIssueText}
          style={[styles.titleInput, isDark && styles.darkText]}
          onChangeText={(text: string) => store.commit(events.uiStateSet({ newIssueText: text }))}
          placeholder="Issue title"
          placeholderTextColor={isDark ? '#a1a1aa' : '#71717a'}
        />
        <TextInput
          value={newIssueDescription}
          onChangeText={(text: string) => store.commit(events.uiStateSet({ newIssueDescription: text }))}
          style={isDark ? styles.darkText : null}
          placeholder="Description..."
          placeholderTextColor={isDark ? '#a1a1aa' : '#71717a'}
          multiline
        />
      </View>
    </Fragment>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    color: '#3b82f6', // blue-500
    paddingHorizontal: 16,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  titleInput: {
    fontWeight: 'bold',
    fontSize: 24,
    marginBottom: 12,
  },
  darkText: {
    color: '#fafafa', // zinc-50
  },
})

export default NewIssueScreen
