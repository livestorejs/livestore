import { queryDb, Schema, sql } from '@livestore/livestore'
import { Stack, useGlobalSearchParams, useRouter } from 'expo-router'
import { Undo2Icon } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'

import { IssueDetailsBottomTab } from '../components/IssueDetailsBottomTab.tsx'
import { IssueStatusIcon, PriorityIcon } from '../components/IssueItem.tsx'
import { ThemedText } from '../components/ThemedText.tsx'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Priority, Status } from '../types.ts'

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 24,
    color: '#000',
  },
  titleDark: {
    color: '#fff',
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
  metadataContainerDark: {
    borderColor: '#3f3f46',
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
  commentsContainer: {
    gap: 16,
    marginTop: 16,
  },
  commentCard: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 8,
    paddingHorizontal: 12,
  },
  commentCardDark: {
    backgroundColor: '#171717',
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  commentAuthor: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  commentDate: {
    fontSize: 12,
  },
  commentContent: {
    fontSize: 14,
  },
  reactionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  reactionBadge: {
    backgroundColor: '#e5e5e5',
    borderRadius: 999,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  reactionBadgeDark: {
    backgroundColor: '#262626',
  },
  reactionText: {
    fontSize: 12,
    lineHeight: 22,
  },
  deletedNotice: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    marginVertical: 8,
    borderRadius: 6,
    padding: 8,
    gap: 8,
  },
  deletedNoticeDark: {
    borderColor: '#3f3f46',
  },
  deletedText: {
    color: 'red',
  },
  undoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  undoButtonActive: {
    backgroundColor: '#f5f5f5',
  },
  undoButtonActiveDark: {
    backgroundColor: '#262626',
  },
  undoText: {
    color: '#007AFF',
  },
  emptyHeaderTitle: {},
})

const IssueDetailsScreen = () => {
  const issueId = useGlobalSearchParams().issueId as string
  const store = useAppStore()
  const router = useRouter()
  const theme = useColorScheme()
  const isDark = theme === 'dark'
  const deletedNoticeStyle = useMemo(
    () => StyleSheet.compose(styles.deletedNotice, isDark ? styles.deletedNoticeDark : undefined),
    [isDark],
  )
  const metadataContainerStyle = useMemo(
    () => StyleSheet.compose(styles.metadataContainer, isDark ? styles.metadataContainerDark : undefined),
    [isDark],
  )
  const titleStyle = useMemo(() => StyleSheet.compose(styles.title, isDark ? styles.titleDark : undefined), [isDark])

  const handleRestoreIssue = useCallback(() => store.commit(events.issueRestored({ id: issueId })), [issueId, store])
  const handleEditIssue = useCallback(() => router.push(`/edit-issue?issueId=${issueId}`), [issueId, router])

  const screenOptions = useMemo(
    () => ({
      headerTitle: `ENG-${issueId.slice(0, 4)}`,
      headerTitleAlign: 'left' as const,
      headerLargeTitleStyle: styles.emptyHeaderTitle,
      headerLeft: EmptyHeaderLeft,
    }),
    [issueId],
  )

  const issue = store.useQuery(
    queryDb(
      {
        query: sql`
            SELECT 
              issues.*,
              users.name as assigneeName,
              users.photoUrl as assigneePhotoUrl
            FROM issues
            LEFT JOIN users ON issues.assigneeId = users.id
            WHERE issues.id = '${issueId}'
          `,
        schema: tables.issues.rowSchema.pipe(
          Schema.extend(Schema.Struct({ assigneeName: Schema.String, assigneePhotoUrl: Schema.String })),
          Schema.Array,
          Schema.headOrElse(),
        ),
      },
      { label: 'issue', deps: `issue-details-${issueId}` },
    ),
  )

  const comments = store.useQuery(
    queryDb(
      {
        query: sql`
            SELECT 
              comments.*,
              users.name as authorName,
              users.photoUrl as authorPhotoUrl,
              (
                SELECT COALESCE(
                  json_group_array(json_object(
                  'id', reactions.id,
                  'emoji', reactions.emoji
                  )), '[]'
                )
              FROM reactions 
              WHERE reactions.commentId = comments.id
            ) as reactions
            FROM comments
            LEFT JOIN users ON comments.userId = users.id
            LEFT JOIN reactions ON reactions.commentId = comments.id
            WHERE comments.issueId = '${issueId}'
            GROUP BY comments.id
            ORDER BY comments.createdAt DESC
          `,
        schema: tables.comments.rowSchema.pipe(
          Schema.extend(
            Schema.Struct({
              authorName: Schema.String,
              authorPhotoUrl: Schema.String,
              reactions: Schema.parseJson(Schema.Array(Schema.Struct({ id: Schema.String, emoji: Schema.String }))),
            }),
          ),
          Schema.Array,
        ),
      },
      { label: 'comments', deps: `issue-details-comments-${issueId}` },
    ),
  )

  if (!issueId) {
    return <ThemedText>Issue not found</ThemedText>
  }

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.scrollView}>
          <View style={styles.contentContainer}>
            {issue.deletedAt ? (
              <View style={deletedNoticeStyle}>
                <ThemedText style={styles.deletedText}>
                  Deleted on {new Date(issue.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                  at{' '}
                  {new Date(issue.deletedAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true,
                  })}{' '}
                </ThemedText>
                <Pressable onPress={handleRestoreIssue} style={styles.undoButton}>
                  <Undo2Icon size={18} />
                  <ThemedText style={styles.undoText}>Undo</ThemedText>
                </Pressable>
              </View>
            ) : null}
            <Pressable onPress={handleEditIssue}>
              <Text style={titleStyle}>{issue.title}</Text>

              <View style={metadataContainerStyle}>
                <View style={styles.metadataItem}>
                  <IssueStatusIcon status={issue.status as Status} />
                  <ThemedText style={styles.metadataText}>{issue.status}</ThemedText>
                </View>

                <View style={styles.metadataItem}>
                  <PriorityIcon priority={issue.priority as Priority} />
                  <ThemedText style={styles.metadataText}>{issue.priority}</ThemedText>
                </View>

                <View style={styles.metadataItem}>
                  <Image source={toUriImageSource(issue.assigneePhotoUrl!)} style={styles.avatar} />
                  <ThemedText style={styles.metadataText}>{issue.assigneeName}</ThemedText>
                </View>
              </View>

              {issue.description ? <ThemedText>{issue.description}</ThemedText> : null}
            </Pressable>

            <View style={styles.commentsContainer}>
              <ThemedText>{comments.length} comments</ThemedText>
              {comments.map((comment) => (
                <View
                  key={comment.id}
                  style={StyleSheet.compose(styles.commentCard, isDark ? styles.commentCardDark : undefined)}
                >
                  <View style={styles.commentHeader}>
                    <Image source={toUriImageSource(comment.authorPhotoUrl)} style={styles.avatar} />
                    <ThemedText style={styles.commentAuthor} numberOfLines={1}>
                      {comment.authorName}
                    </ThemedText>
                    <ThemedText style={styles.commentDate}>{new Date(comment.createdAt!).toDateString()}</ThemedText>
                  </View>
                  <ThemedText style={styles.commentContent}>{comment.content}</ThemedText>

                  <View style={styles.reactionsContainer}>
                    {comment.reactions.map((reaction) => (
                      <View
                        key={reaction.id}
                        style={StyleSheet.compose(styles.reactionBadge, isDark ? styles.reactionBadgeDark : undefined)}
                      >
                        <ThemedText style={styles.reactionText}>{reaction.emoji} 1</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <IssueDetailsBottomTab issueId={issue.id} />
    </>
  )
}

export default IssueDetailsScreen

const EmptyHeaderLeft = () => <></>

const toUriImageSource = (uri: string) => ({ uri })
