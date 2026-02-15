import { nanoid } from '@livestore/livestore'
import { Stack, useRouter } from 'expo-router'
import { Fragment, useCallback, useMemo } from 'react'
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { useUser } from '../../hooks/useUser.ts'
import { uiState$ } from '../../livestore/queries.ts'
import { events } from '../../livestore/schema.ts'
import { useAppStore } from '../../livestore/store.ts'
import { PRIORITIES, STATUSES } from '../../types.ts'

const NewIssueScreen = () => {
  const user = useUser()
  const router = useRouter()
  const store = useAppStore()
  const { newIssueText, newIssueDescription } = store.useQuery(uiState$)
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const handleCreateIssue = useCallback(() => {
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
  }, [newIssueDescription, newIssueText, router, store, user.id])

  const handleBack = useCallback(() => router.back(), [router])
  const handleNewIssueTextChange = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newIssueText: text })),
    [store],
  )
  const handleNewIssueDescriptionChange = useCallback(
    (text: string) => store.commit(events.uiStateSet({ newIssueDescription: text })),
    [store],
  )
  const titleInputStyle = useMemo(
    () => StyleSheet.compose(styles.titleInput, isDark ? styles.darkText : undefined),
    [isDark],
  )
  const descriptionInputStyle = useMemo(() => (isDark ? styles.darkText : undefined), [isDark])

  const screenOptions = useMemo(
    () => ({
      title: 'New Issue',
      headerRight: () => (
        <Pressable onPress={handleCreateIssue}>
          <Text style={styles.actionButton}>Create</Text>
        </Pressable>
      ),
      headerLeft: () => (
        <Pressable onPress={handleBack}>
          <Text style={styles.actionButton}>Cancel</Text>
        </Pressable>
      ),
      freezeOnBlur: false,
    }),
    [handleBack, handleCreateIssue],
  )

  return (
    <Fragment>
      <Stack.Screen options={screenOptions} />
      <View style={styles.container}>
        <TextInput
          value={newIssueText}
          style={titleInputStyle}
          onChangeText={handleNewIssueTextChange}
          placeholder="Issue title"
          placeholderTextColor={isDark ? '#a1a1aa' : '#71717a'}
        />
        <TextInput
          value={newIssueDescription}
          onChangeText={handleNewIssueDescriptionChange}
          style={descriptionInputStyle}
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
