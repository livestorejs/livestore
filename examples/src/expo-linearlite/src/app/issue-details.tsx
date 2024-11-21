import { queryDb, sql } from '@livestore/livestore'
import { useScopedQuery, useStore } from '@livestore/react'
import { Schema } from 'effect'
import { Stack, useGlobalSearchParams, useRouter } from 'expo-router'
import { Undo2Icon } from 'lucide-react-native'
import { useMemo } from 'react'
import { Image, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native'

import IssueDetailsBottomTab from '@/components/IssueDetailsBottomTab.tsx'
import { IssueStatusIcon, PriorityIcon } from '@/components/IssueItem.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import type { Comment } from '@/livestore/schema.ts'
import { issuesMutations } from '@/livestore/schema.ts'
import type { Priority, Status } from '@/types.ts'

const IssueDetailsScreen = () => {
  const issueId = useGlobalSearchParams().issueId
  const store = useStore()
  const router = useRouter()

  const issueQuery = useMemo(
    () =>
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
          schema: Schema.Any,
        },
        { label: 'issue' },
      ),
    [issueId],
  )

  const issue = useScopedQuery(() => issueQuery, 'issue')[0]

  const commentsQuery = useMemo(
    () =>
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
          schema: Schema.Any,
        },
        { label: 'comments' },
      ),
    [issueId],
  )

  const comments = useScopedQuery(() => commentsQuery, 'comments')

  if (!issueId) {
    return <ThemedText>Issue not found</ThemedText>
  }

  const parsedComments = comments.map((comment: Comment & { reactions: string }) => ({
    ...comment,
    reactions: JSON.parse(comment.reactions || '[]'),
  }))

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
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }}>
          <View className="px-5">
            {issue.deletedAt ? (
              <View className="flex-row justify-between border my-2 border-zinc-200 dark:border-zinc-700 rounded-md p-2 gap-2">
                <ThemedText style={{ color: 'red' }}>
                  Deleted on{' '}
                  {new Date(issue.deletedAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at{' '}
                  {new Date(issue.deletedAt * 1000).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true,
                  })}{' '}
                </ThemedText>
                <Pressable
                  onPress={() => store.store.mutate(issuesMutations.restoreIssue({ id: issue.id }))}
                  className="flex-row items-center gap-2 active:bg-zinc-100 dark:active:bg-zinc-800"
                >
                  <Undo2Icon size={18} />
                  <ThemedText style={{ color: '#007AFF' }}>Undo</ThemedText>
                </Pressable>
              </View>
            ) : null}
            <Pressable onPress={() => router.push(`/edit-issue?issueId=${issue.id}`)}>
              <Text className="font-bold text-2xl dark:text-white">{issue.title}</Text>

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
                  <Image source={{ uri: issue.assigneePhotoUrl! }} className="w-5 h-5 rounded-full" />
                  <ThemedText style={{ fontSize: 14, fontWeight: '500' }}>{issue.assigneeName}</ThemedText>
                </View>
              </View>

              {issue.description ? <ThemedText>{issue.description}</ThemedText> : null}
            </Pressable>

            <View className="gap-4 mt-4">
              <ThemedText>{comments.length} comments</ThemedText>
              {parsedComments.map(
                (
                  comment: Comment & {
                    authorName: string
                    authorPhotoUrl: string
                    reactions: { id: string; emoji: string }[]
                  },
                ) => (
                  <View key={comment.id} className="bg-neutral-100 dark:bg-neutral-900 rounded-xl p-2 px-3">
                    <View className="flex-row items-center gap-2 flex-shrink">
                      <Image source={{ uri: comment.authorPhotoUrl }} className="w-5 h-5 rounded-full" />
                      <ThemedText className="line-clamp-1 flex-shrink" style={{ fontSize: 14, fontWeight: '500' }}>
                        {comment.authorName}
                      </ThemedText>
                      <ThemedText style={{ fontSize: 12 }}>{new Date(comment.createdAt!).toDateString()}</ThemedText>
                    </View>
                    <ThemedText className="" style={{ fontSize: 14 }}>
                      {comment.content}
                    </ThemedText>

                    <View className="flex-row items-center gap-2 mt-1">
                      {comment.reactions.length > 0
                        ? comment.reactions.map((reaction) => {
                            return (
                              <View
                                key={reaction.id}
                                className="bg-neutral-200 dark:bg-neutral-800 rounded-full px-2 self-start"
                              >
                                <ThemedText
                                  style={{
                                    fontSize: 12,
                                    lineHeight: 22,
                                  }}
                                >
                                  {reaction.emoji} 1
                                </ThemedText>
                              </View>
                            )
                          })
                        : null}
                    </View>
                  </View>
                ),
              )}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <IssueDetailsBottomTab issueId={issue.id} />
    </>
  )
}

export default IssueDetailsScreen
