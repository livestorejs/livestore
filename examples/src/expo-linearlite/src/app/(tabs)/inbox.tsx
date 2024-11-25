import { queryDb } from '@livestore/livestore'
import { useScopedQuery, useStore } from '@livestore/react'
import { Stack } from 'expo-router'
import React from 'react'
import { Button, ScrollView, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/ThemedText.tsx'
import { useUser } from '@/hooks/useUser.ts'
import type { Comment, Issue, Reaction, User } from '@/livestore/schema.ts'
import { issuesMutations, tables, userMutations } from '@/livestore/schema.ts'
import {
  createRandomComment,
  createRandomIssue,
  createRandomReaction,
  createRandomUser,
  randomValueFromArray,
} from '@/utils/generate-fake-data.ts'

const COMMENTS_PER_ISSUE = 10

const InboxScreen = () => {
  const user = useUser()
  const { store } = useStore()

  const users = useScopedQuery(() => queryDb(tables.users.query.where({}), { label: 'inbox-users' }), ['inbox-users'])

  const generateRandomData = (numUsers: number, numIssuesPerUser: number) => {
    const users: User[] = []
    const issues: Issue[] = []
    const comments: Comment[] = []
    const reactions: Reaction[] = []

    // Generate users
    for (let i = 0; i < numUsers; i++) {
      const user = createRandomUser()
      users.push(user)

      // Generate issues for each user
      for (let j = 0; j < numIssuesPerUser; j++) {
        const issue = createRandomIssue(user.id)
        issues.push(issue)

        // Generate 0-3 comments for each issue
        const numComments = Math.floor(Math.random() * COMMENTS_PER_ISSUE + 1)
        for (let k = 0; k < numComments; k++) {
          const comment = createRandomComment(issue.id, user.id)
          comments.push(comment)

          // Generate 0-2 reactions for each comment
          const numReactions = Math.floor(Math.random() * 3)
          for (let l = 0; l < numReactions; l++) {
            const reaction = createRandomReaction(issue.id, user.id, comment.id)
            reactions.push(reaction)
          }
        }
      }
    }
    // Add generated data to the store
    store.mutate(
      ...users.map((user) => userMutations.createUser(user)),
      ...issues.map((issue) => issuesMutations.createIssue(issue)),
      ...comments.map((comment) => issuesMutations.createComment(comment)),
      ...reactions.map((reaction) => issuesMutations.createReaction(reaction)),
    )
  }

  const generateIssuesForCurrentUser = (numberOfIssues: number) => {
    const issues: Issue[] = []
    const comments: Comment[] = []
    const reactions: Reaction[] = []

    for (let i = 0; i < numberOfIssues; i++) {
      const issue = createRandomIssue(user.id)
      issues.push(issue)

      // Generate comments using users
      const numComments = Math.floor(Math.random() * COMMENTS_PER_ISSUE + 1)
      for (let j = 0; j < numComments; j++) {
        const comment = createRandomComment(issue.id, randomValueFromArray(users).id)
        comments.push(comment)

        const numReactions = Math.floor(Math.random() * 2)
        for (let k = 0; k < numReactions; k++) {
          const reaction = createRandomReaction(issue.id, randomValueFromArray(users).id, comment.id)
          reactions.push(reaction)
        }
      }
    }

    store.mutate(
      ...issues.map((issue) => issuesMutations.createIssue(issue)),
      ...comments.map((comment) => issuesMutations.createComment(comment)),
      ...reactions.map((reaction) => issuesMutations.createReaction(reaction)),
    )
  }

  const reset = () => store.mutate(issuesMutations.clearAll({ deleted: Date.now() }))

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Control Center' }} />
      <ScrollView style={styles.container}>
        <View style={styles.section}>
          <ThemedText type="subtitle">🧪 Test Data Generation</ThemedText>
          <ThemedText>
            Generate sample data to explore the app's functionality. Each issue includes comments and reactions from
            various users.
          </ThemedText>
          <View style={styles.buttonGroup}>
            <Button title="Quick Demo: 5 users, 10 issues" onPress={() => generateRandomData(5, 10)} />
            <Button title={`Generate 50 issues for ${user.name}`} onPress={() => generateIssuesForCurrentUser(50)} />
            <Button title="Large Dataset: 50 users, 10 issues" onPress={() => generateRandomData(50, 10)} />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="subtitle">🧹 Data Management</ThemedText>
          <ThemedText>
            Reset the database to start fresh. This will remove all generated issues, comments, and reactions.
          </ThemedText>
          <Button title="Clear all issues" onPress={reset} />
        </View>

        <View style={styles.infoSection}>
          <ThemedText type="subtitle">ℹ️ About This Screen</ThemedText>
          <ThemedText>
            This control center allows you to populate the app with test data to explore its features. Each generated
            issue includes:
          </ThemedText>
          <View style={styles.bulletPoints}>
            <ThemedText>• Random title and description</ThemedText>
            <ThemedText>• {COMMENTS_PER_ISSUE} comments per issue (max)</ThemedText>
            <ThemedText>• Random reactions from users</ThemedText>
          </View>
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  section: {
    borderRadius: 12,
    gap: 8,
    marginVertical: 16,
  },
  buttonGroup: {
    gap: 12,
  },
  infoSection: {
    marginTop: 8,
    padding: 16,
  },
  bulletPoints: {
    paddingLeft: 8,
  },
})

export default InboxScreen
