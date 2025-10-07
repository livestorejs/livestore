import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { Stack } from 'expo-router'
import React from 'react'
import type { ViewStyle } from 'react-native'
import { ActivityIndicator, Button, ScrollView, StyleSheet, useColorScheme, View } from 'react-native'

import { ThemedText } from '@/components/ThemedText.tsx'
import { useUser } from '@/hooks/useUser.ts'
import { createRandomComment, createRandomIssue, createRandomUser, makeNextIssueId } from '@/utils/generate-fake-data.ts'

import { events, tables } from '../../livestore/schema.ts'

const COMMENTS_PER_ISSUE = 10

const InboxScreen = () => {
  const user = useUser()
  const { store } = useStore()
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadingMessage, setLoadingMessage] = React.useState<{
    operation: string
    items: { label: string; count: number }[]
    progress?: { current: number; total: number }
    phase?: string
  } | null>(null)
  const [timingResults, setTimingResults] = React.useState<{
    operation: string
    generationTime: number
    commitTime: number
    breakdown: { label: string; count: number; time: number }[]
    totalItems: number
    totalTime: number
  } | null>(null)

  

  const generateRandomData = async (numUsers: number, numIssuesPerUser: number) => {
    const startTime = performance.now()

    // Calculate estimated totals
    const totalIssues = numUsers * numIssuesPerUser
    const estimatedComments = totalIssues * (COMMENTS_PER_ISSUE / 2) // Average
    const totalItems = numUsers + totalIssues + estimatedComments

    const totalObjects = Math.round(totalItems)

    setLoadingMessage({
      operation: 'Generating Random Data',
      items: [
        { label: 'Users', count: numUsers },
        { label: 'Issues', count: totalIssues },
        { label: `Comments (avg ${COMMENTS_PER_ISSUE / 2} per issue)`, count: Math.round(estimatedComments) },
        
        { label: 'Total Objects', count: totalObjects },
      ],
      progress: { current: 0, total: totalIssues },
      phase: 'Generating data...',
    })
    setIsLoading(true)
    try {
      // Use setTimeout to ensure the loading indicator renders before heavy computation
      await new Promise((resolve) => setTimeout(resolve, 0))

      const generationStart = performance.now()
      console.log('🏗️ Starting data generation at', `${generationStart.toFixed(0)}ms`)

      const users: ReturnType<typeof createRandomUser>[] = []
      const issues: ReturnType<typeof createRandomIssue>[] = []
      const comments: ReturnType<typeof createRandomComment>[] = []

      const BATCH_SIZE = 5 // Yield every 5 issues
      let issuesCreated = 0

      const nextIssueId = makeNextIssueId(store)
      // Generate users in batches
      for (let i = 0; i < numUsers; i++) {
        const newUser = createRandomUser()
        users.push(newUser)

        // Generate issues for each user
        for (let j = 0; j < numIssuesPerUser; j++) {
          const issue = createRandomIssue(newUser.id, nextIssueId())
          issues.push(issue)
          issuesCreated++

          // Generate comments for each issue
          const numComments = Math.floor(Math.random() * COMMENTS_PER_ISSUE + 1)
          for (let k = 0; k < numComments; k++) {
            const comment = createRandomComment(issue.id, newUser.id)
            comments.push(comment)

            
          }

          // Yield control back to UI every BATCH_SIZE issues
          if (issuesCreated % BATCH_SIZE === 0 || issuesCreated === totalIssues) {
            setLoadingMessage((prev) =>
              prev
                ? {
                    ...prev,
                    progress: { current: issuesCreated, total: totalIssues },
                    phase: 'Generating data...',
                  }
                : null,
            )
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        }
      }

      const generationTime = performance.now() - generationStart
      console.log(
        '✅ Generation finished in',
        `${generationTime.toFixed(0)}ms`,
        '| Created',
        users.length,
        'users,',
        issues.length,
        'issues,',
        comments.length,
        'comments',
      )

      // Update to show we're committing
      const actualTotal = users.length + issues.length + comments.length
      setLoadingMessage((prev) =>
        prev
          ? {
              ...prev,
              phase: `Saving ${actualTotal.toLocaleString()} objects to database...`,
              progress: undefined, // Hide progress bar during commit
            }
          : null,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Commit all data in a SINGLE transaction to avoid multiple React re-renders
      const commitStart = performance.now()
      console.log('⏱️ Starting commit of', actualTotal, 'items at', `${commitStart.toFixed(0)}ms`)

      const nameById = new Map(users.map((u) => [u.id, u.name] as const))
      const issueEvents = issues.map((i) =>
        events.createIssueWithDescription({
          id: i.id,
          title: i.title,
          description: i.description ?? '',
          creator: i.assigneeId ? nameById.get(i.assigneeId) ?? user.name : user.name,
          status: 0,
          priority: 0,
          created: i.createdAt,
          modified: i.updatedAt,
          kanbanorder: 'a1',
        }),
      )
      const commentEvents = comments.map((c) =>
        events.createComment({
          id: c.id,
          body: c.content,
          issueId: c.issueId,
          creator: nameById.get(c.userId) ?? user.name,
          created: c.createdAt,
        }),
      )

      store.commit(
        
        ...issueEvents,
        ...commentEvents,
      )

      const commitTime = performance.now() - commitStart
      console.log('✅ Commit finished in', `${commitTime.toFixed(0)}ms`)
      console.log('⏱️ Yielding for React updates at', `${(performance.now() - startTime).toFixed(0)}ms`)

      // Create breakdown for display (even though we committed as one batch)
      const breakdown: { label: string; count: number; time: number }[] = [
        { label: 'Users', count: users.length, time: 0 },
        { label: 'Issues', count: issues.length, time: 0 },
        { label: 'Comments', count: comments.length, time: 0 },
        
      ]

      // Yield to let React process store updates and measure the overhead
      await new Promise((resolve) => setTimeout(resolve, 0))

      const totalTime = performance.now() - startTime
      console.log(
        '🏁 Total time:',
        `${totalTime.toFixed(0)}ms`,
        '| React overhead:',
        `${(totalTime - commitTime - generationTime).toFixed(0)}ms`,
      )

      // Show timing results
      setTimingResults({
        operation: 'Random Data Generation',
        generationTime,
        commitTime,
        breakdown,
        totalItems: actualTotal,
        totalTime,
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  const generateIssuesForCurrentUser = async (numberOfIssues: number) => {
    const startTime = performance.now()

    // Calculate estimated totals
    const estimatedComments = numberOfIssues * (COMMENTS_PER_ISSUE / 2) // Average
    const totalItems = numberOfIssues + estimatedComments

    const totalObjects = Math.round(totalItems)

    setLoadingMessage({
      operation: `Generating Issues for ${user.name}`,
      items: [
        { label: 'Issues', count: numberOfIssues },
        { label: `Comments (avg ${COMMENTS_PER_ISSUE / 2} per issue)`, count: Math.round(estimatedComments) },
        
        { label: 'Total Objects', count: totalObjects },
      ],
      progress: { current: 0, total: numberOfIssues },
      phase: 'Generating data...',
    })
    setIsLoading(true)
    try {
      // Use setTimeout to ensure the loading indicator renders before heavy computation
      await new Promise((resolve) => setTimeout(resolve, 0))

      const generationStart = performance.now()

      const issues: ReturnType<typeof createRandomIssue>[] = []
      const comments: ReturnType<typeof createRandomComment>[] = []

      const BATCH_SIZE = 5 // Yield every 5 issues

      const nextIssueId2 = makeNextIssueId(store)
      for (let i = 0; i < numberOfIssues; i++) {
        const issue = createRandomIssue(user.id, nextIssueId2())
        issues.push(issue)

        // Generate comments using users
        const numComments = Math.floor(Math.random() * COMMENTS_PER_ISSUE + 1)
        for (let j = 0; j < numComments; j++) {
          const comment = createRandomComment(issue.id, user.id)
          comments.push(comment)

          
        }

        // Yield control back to UI every BATCH_SIZE issues
        if ((i + 1) % BATCH_SIZE === 0 || i === numberOfIssues - 1) {
          setLoadingMessage((prev) =>
            prev
              ? {
                  ...prev,
                  progress: { current: i + 1, total: numberOfIssues },
                  phase: 'Generating data...',
                }
              : null,
          )
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }

      const generationTime = performance.now() - generationStart

      // Update to show we're committing
      const actualTotal = issues.length + comments.length
      setLoadingMessage((prev) =>
        prev
          ? {
              ...prev,
              phase: `Saving ${actualTotal.toLocaleString()} objects to database...`,
              progress: undefined, // Hide progress bar during commit
            }
          : null,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Commit all data in a SINGLE transaction to avoid multiple React re-renders
      const commitStart = performance.now()

      const issueEvents2 = issues.map((i) =>
        events.createIssueWithDescription({
          id: i.id,
          title: i.title,
          description: i.description ?? '',
          creator: user.name,
          status: 0,
          priority: 0,
          created: i.createdAt,
          modified: i.updatedAt,
          kanbanorder: 'a1',
        }),
      )
      const commentEvents2 = comments.map((c) =>
        events.createComment({
          id: c.id,
          body: c.content,
          issueId: c.issueId,
          creator: user.name,
          created: c.createdAt,
        }),
      )
      store.commit(
        
        ...issueEvents2,
        ...commentEvents2,
      )

      const commitTime = performance.now() - commitStart

      // Create breakdown for display (even though we committed as one batch)
      const breakdown: { label: string; count: number; time: number }[] = [
        { label: 'Issues', count: issues.length, time: 0 },
        { label: 'Comments', count: comments.length, time: 0 },
        
      ]

      // Yield to let React process store updates and measure the overhead
      await new Promise((resolve) => setTimeout(resolve, 0))

      const totalTime = performance.now() - startTime

      // Show timing results
      setTimingResults({
        operation: `Issues for ${user.name}`,
        generationTime,
        commitTime,
        breakdown,
        totalItems: actualTotal,
        totalTime,
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  const reset = async () => {
    setLoadingMessage({
      operation: 'Clearing All Data',
      items: [{ label: 'Removing all issues, comments, and reactions', count: 0 }],
      phase: 'Clearing database...',
    })
    setIsLoading(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      // Soft-delete all active issues via per-row delete events
      const ids = store.query(tables.issues.select().where({ deletedAt: null })).map((r) => r.id)
      const now = new Date()
      store.commit(...ids.map((id) => events.deleteIssue({ id, deleted: now })))
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  const issuesCount$ = queryDb(tables.issues.count().where({ deletedAt: null }))
  const issuesDeletedCount$ = queryDb(tables.issues.count().where({ deletedAt: { op: '!=', value: null } }))
  const issuesCount = useQuery(issuesCount$)
  const issuesDeletedCount = useQuery(issuesDeletedCount$)

  const isDarkMode = useColorScheme() === 'dark'
  const sectionStyle = StyleSheet.compose<ViewStyle, any, any>(styles.section, {
    boxShadow: isDarkMode ? '0px 0px 10px 0px rgba(255, 255, 255, 0.1)' : '0px 0px 10px 0px rgba(0, 0, 0, 0.1)',
  })

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Inbox',
        }}
      />
      <ScrollView style={styles.container}>
        <View style={styles.statsSection}>
          <View style={[styles.statsItem, styles.statsItemActive]}>
            <ThemedText style={styles.statsValue}>{issuesCount}</ThemedText>
            <ThemedText style={styles.statsLabel}>Active Issues</ThemedText>
          </View>
          <View style={[styles.statsItem, styles.statsItemDeleted]}>
            <ThemedText style={styles.statsValue}>{issuesDeletedCount}</ThemedText>
            <ThemedText style={styles.statsLabel}>Deleted</ThemedText>
          </View>
        </View>

        <View style={sectionStyle}>
          <ThemedText type="subtitle">🧪 Test Data Generation</ThemedText>
          <ThemedText>
            Generate sample data to explore the app's functionality. Each issue includes comments from various users.
          </ThemedText>
          <View style={styles.buttonGroup}>
            <Button
              title="Quick Demo: 5 users, 10 issues"
              onPress={() => generateRandomData(5, 10)}
              disabled={isLoading}
            />
            <Button
              title={`Generate 50 issues for ${user.name}`}
              onPress={() => generateIssuesForCurrentUser(50)}
              disabled={isLoading}
            />
            <Button
              title="Large Dataset: 50 users, 10 issues"
              onPress={() => generateRandomData(50, 10)}
              disabled={isLoading}
            />
          </View>
        </View>

        <View style={sectionStyle}>
          <ThemedText type="subtitle">🧹 Data Management</ThemedText>
          <ThemedText>
            Reset the database to start fresh. This will remove all generated issues, comments, and reactions.
          </ThemedText>
          <Button title="Clear all issues" onPress={reset} disabled={isLoading} />
        </View>

        <View style={sectionStyle}>
          <ThemedText type="subtitle">ℹ️ About This Screen</ThemedText>
          <ThemedText>
            This control center allows you to populate the app with test data to explore its features. Each generated
            issue includes:
          </ThemedText>
          <View style={styles.bulletPoints}>
            <ThemedText>• Random title and description</ThemedText>
            <ThemedText>• {COMMENTS_PER_ISSUE} comments per issue (max)</ThemedText>
          </View>
        </View>
      </ScrollView>

      {isLoading && loadingMessage && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ThemedText type="subtitle" style={styles.loadingTitle}>
              {loadingMessage.operation}
            </ThemedText>

            <View style={styles.calculationBox}>
              {loadingMessage.items.map((item) => (
                <View key={item.label} style={styles.calculationRow}>
                  <ThemedText style={styles.calculationLabel}>{item.label}</ThemedText>
                  <ThemedText type="defaultSemiBold" style={styles.calculationValue}>
                    {item.count > 0 ? item.count.toLocaleString() : '—'}
                  </ThemedText>
                </View>
              ))}
            </View>

            {loadingMessage.progress && (
              <View style={styles.progressSection}>
                <ThemedText style={styles.progressLabel}>
                  Progress: {loadingMessage.progress.current} / {loadingMessage.progress.total}
                </ThemedText>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${(loadingMessage.progress.current / loadingMessage.progress.total) * 100}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}

            <View style={styles.loadingSpinnerContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <ThemedText style={styles.phaseText}>{loadingMessage.phase || 'Please wait...'}</ThemedText>
            </View>
          </View>
        </View>
      )}

      {timingResults && (
        <View style={styles.loadingOverlay}>
          <View style={styles.resultsContainer}>
            <ThemedText type="title" style={styles.resultsTitle}>
              ✅ {timingResults.operation} Complete
            </ThemedText>

            <View style={styles.summaryBox}>
              <ThemedText type="subtitle" style={styles.summaryTitle}>
                Summary
              </ThemedText>
              <View style={styles.summaryRow}>
                <ThemedText style={styles.summaryLabel}>Total Items:</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.summaryValue}>
                  {timingResults.totalItems.toLocaleString()}
                </ThemedText>
              </View>
              <View style={styles.summaryRow}>
                <ThemedText style={styles.summaryLabel}>Total Time:</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.summaryValueHighlight}>
                  {timingResults.totalTime.toFixed(0)}ms
                </ThemedText>
              </View>
            </View>

            <View style={styles.timingBox}>
              <ThemedText type="subtitle" style={styles.timingTitle}>
                Performance Breakdown
              </ThemedText>

              <View style={styles.timingPhaseRow}>
                <ThemedText style={styles.timingLabel}>1. Data Generation:</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.timingValue}>
                  {timingResults.generationTime.toFixed(0)}ms
                </ThemedText>
              </View>

              <View style={styles.timingPhaseRow}>
                <ThemedText style={styles.timingLabel}>2. Database Commit:</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.timingValueHighlight}>
                  {timingResults.commitTime.toFixed(0)}ms
                </ThemedText>
              </View>

              <View style={styles.timingPhaseRow}>
                <ThemedText style={styles.timingLabel}>3. React Updates:</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.timingValue}>
                  {(timingResults.totalTime - timingResults.generationTime - timingResults.commitTime).toFixed(0)}ms
                </ThemedText>
              </View>

              <View style={styles.divider} />

              <ThemedText style={styles.breakdownTitle}>Items Committed:</ThemedText>
              {timingResults.breakdown.map((item) => (
                <View key={item.label} style={styles.breakdownRow}>
                  <ThemedText style={styles.breakdownLabel}>{item.label}:</ThemedText>
                  <ThemedText type="defaultSemiBold" style={styles.breakdownCount}>
                    {item.count.toLocaleString()}
                  </ThemedText>
                </View>
              ))}
            </View>

            <Button title="Done" onPress={() => setTimingResults(null)} />
          </View>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  statsSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statsItem: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  statsItemActive: {
    backgroundColor: '#34D399',
  },
  statsItemDeleted: {
    backgroundColor: '#EF4444',
  },
  statsValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  statsLabel: {
    fontSize: 14,
    color: 'white',
    textAlign: 'center',
    marginTop: 4,
  },
  section: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  buttonGroup: {
    gap: 8,
    marginTop: 8,
  },
  infoSection: {
    marginTop: 8,
    padding: 16,
  },
  bulletPoints: {
    paddingLeft: 8,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    gap: 16,
  },
  loadingTitle: {
    textAlign: 'center',
    fontSize: 18,
    marginBottom: 4,
  },
  calculationBox: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  calculationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  calculationLabel: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  calculationValue: {
    fontSize: 14,
    color: '#007AFF',
    minWidth: 50,
    textAlign: 'right',
  },
  progressSection: {
    gap: 10,
  },
  progressLabel: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
  loadingSpinnerContainer: {
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  phaseText: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '500',
  },
  resultsContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 16,
    maxHeight: '90%',
  },
  resultsTitle: {
    textAlign: 'center',
    fontSize: 20,
    marginBottom: 8,
  },
  summaryBox: {
    backgroundColor: '#f0f9ff',
    borderRadius: 10,
    padding: 16,
    gap: 8,
  },
  summaryTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 14,
    color: '#333',
  },
  summaryValue: {
    fontSize: 16,
    color: '#007AFF',
  },
  summaryValueHighlight: {
    fontSize: 16,
    color: '#10b981',
  },
  timingBox: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 16,
  },
  timingTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  timingPhaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timingLabel: {
    fontSize: 14,
    color: '#333',
  },
  timingValue: {
    fontSize: 14,
    color: '#007AFF',
  },
  timingValueHighlight: {
    fontSize: 14,
    color: '#f59e0b',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  breakdownTitle: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
    fontWeight: '600',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#333',
  },
  breakdownCount: {
    fontSize: 13,
    color: '#007AFF',
  },
})

export default InboxScreen
