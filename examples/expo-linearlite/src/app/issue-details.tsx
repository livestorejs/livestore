import { nanoid, queryDb, Schema, sql } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { Stack, useGlobalSearchParams, useRouter } from 'expo-router'
import React from 'react'
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { IssueDetailsBottomTab } from '@/components/IssueDetailsBottomTab.tsx'
import { IssueStatusIcon, PriorityIcon } from '@/components/IssueItem.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { useUser } from '@/hooks/useUser.ts'
import { events, tables } from '@/livestore/schema.ts'
import type { Priority, Status } from '@/types.ts'

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
})

const IssueDetailsScreen = () => {
  const rawIssueId = useGlobalSearchParams().issueId as string | string[] | undefined
  const issueId = (Array.isArray(rawIssueId) ? rawIssueId[rawIssueId.length - 1] : (rawIssueId ?? '')).split('?')[0]
  const issueIdNum = Number(issueId)
  const _store = useStore()
  const router = useRouter()
  const theme = useColorScheme()
  const isDark = theme === 'dark'
  const user = useUser()
  const [pickerForComment, setPickerForComment] = React.useState<string | null>(null)

  const issue = useQuery(
    queryDb(
      {
        query: sql`SELECT issues.* FROM issues WHERE issues.id = ${Number.isFinite(issueIdNum) ? issueIdNum : -1}`,
        schema: tables.issues.rowSchema.pipe(Schema.Array, Schema.headOrElse()),
      },
      { label: 'issue', deps: `issue-details-${issueId}` },
    ),
  )

  const comments = useQuery(
    queryDb(
      {
        query: sql`
            SELECT 
              comments.*,
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
            LEFT JOIN reactions ON reactions.commentId = comments.id
            WHERE comments.issueId = ${Number.isFinite(issueIdNum) ? issueIdNum : -1}
            GROUP BY comments.id
            ORDER BY comments.createdAt DESC
          `,
        schema: tables.comments.rowSchema.pipe(
          Schema.extend(
            Schema.Struct({
              reactions: Schema.parseJson(Schema.Array(Schema.Struct({ id: Schema.String, emoji: Schema.String }))),
            }),
          ),
          Schema.Array,
        ),
      },
      { label: 'comments', deps: `issue-details-comments-${issueId}` },
    ),
  )

  if (!issueId || !Number.isFinite(issueIdNum)) {
    return <ThemedText>Issue not found</ThemedText>
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: `ENG-${issueId.slice(0, 4)}`,
          headerTitleAlign: 'left',
          headerLargeTitleStyle: {},
          headerLeft: () => <></>,
        }}
      />
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.scrollView}>
          <View style={styles.contentContainer}>
            {issue.deletedAt ? (
              <View style={[styles.deletedNotice, issue.deletedAt && styles.deletedNoticeDark]}>
                <ThemedText style={styles.deletedText}>
                  Deleted on {new Date(issue.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                  at{' '}
                  {new Date(issue.deletedAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true,
                  })}{' '}
                </ThemedText>
                {/* Restore not supported in Web-aligned event model */}
              </View>
            ) : null}
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/edit-issue',
                  params: { issueId: String(issue.id), storeId: _store.store.storeId },
                })
              }
            >
              <Text style={[styles.title, isDark && styles.titleDark]}>{issue.title}</Text>

              <View style={[styles.metadataContainer, isDark && styles.metadataContainerDark]}>
                <View style={styles.metadataItem}>
                  <IssueStatusIcon status={issue.status as Status} />
                </View>

                <View style={styles.metadataItem}>
                  <PriorityIcon priority={issue.priority as Priority} />
                </View>

                <View style={styles.metadataItem}>
                  {issue.assigneeName ? (
                    <Image
                      source={{
                        uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(issue.assigneeName)}&size=40`,
                      }}
                      style={styles.avatar}
                    />
                  ) : null}
                  <ThemedText style={styles.metadataText}>{issue.assigneeName}</ThemedText>
                </View>
              </View>

              {issue.description ? <ThemedText>{issue.description}</ThemedText> : null}
            </Pressable>

            <View style={styles.commentsContainer}>
              <ThemedText>{comments.length} comments</ThemedText>
              {comments.map((comment) => (
                <View key={comment.id} style={[styles.commentCard, isDark && styles.commentCardDark]}>
                  <View style={styles.commentHeader}>
                    {comment.authorName ? (
                      <Image
                        source={{
                          uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.authorName)}&size=40`,
                        }}
                        style={styles.avatar}
                      />
                    ) : null}
                    <ThemedText style={styles.commentAuthor} numberOfLines={1}>
                      {comment.authorName}
                    </ThemedText>
                    <ThemedText style={styles.commentDate}>{new Date(comment.createdAt!).toDateString()}</ThemedText>
                  </View>
                  <ThemedText style={styles.commentContent}>{comment.content}</ThemedText>
                  <View style={styles.reactionsContainer}>
                    {comment.reactions.map((reaction) => (
                      <View key={reaction.id} style={[styles.reactionBadge, isDark && styles.reactionBadgeDark]}>
                        <ThemedText style={styles.reactionText}>{reaction.emoji} 1</ThemedText>
                      </View>
                    ))}
                    <Pressable onPress={() => setPickerForComment((c) => (c === comment.id ? null : comment.id))}>
                      <ThemedText style={styles.reactionText}>+ Add reaction</ThemedText>
                    </Pressable>
                  </View>

                  {pickerForComment === comment.id ? (
                    <View style={[styles.reactionsContainer, { marginTop: 8 }]}>
                      {['👍', '👎', '💯', '👀', '🤔', '✅', '🔥'].map((emoji) => (
                        <Pressable
                          key={emoji}
                          onPress={() => {
                            _store.store.commit(
                              events.reactionCreated({
                                id: nanoid(),
                                issueId: String(issue.id),
                                commentId: comment.id,
                                userId: user.id,
                                emoji,
                              }),
                            )
                            setPickerForComment(null)
                          }}
                        >
                          <View style={[styles.reactionBadge, isDark && styles.reactionBadgeDark]}>
                            <ThemedText style={styles.reactionText}>{emoji}</ThemedText>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
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
