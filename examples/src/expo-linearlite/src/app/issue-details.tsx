import { queryDb, Schema, sql } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { Stack, useGlobalSearchParams, useRouter } from 'expo-router'
import { Undo2Icon } from 'lucide-react-native'
import React from 'react'
import { Image, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native'

import { IssueDetailsBottomTab } from '@/components/IssueDetailsBottomTab.tsx'
import { IssueStatusIcon, PriorityIcon } from '@/components/IssueItem.tsx'
import { ThemedText } from '@/components/ThemedText.tsx'
import { issuesMutations, tables } from '@/livestore/schema.ts'
import type { Priority, Status } from '@/types.ts'

const IssueDetailsScreen = () => {
  const issueId = useGlobalSearchParams().issueId as string
  const store = useStore()
  const router = useRouter()

  const issue = useQuery(
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
        schema: tables.issues.schema.pipe(
          Schema.extend(Schema.Struct({ assigneeName: Schema.String, assigneePhotoUrl: Schema.String })),
          Schema.Array,
          Schema.headOrElse(),
        ),
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
        schema: tables.comments.schema.pipe(
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
                  onPress={() => store.store.commit(issuesMutations.restoreIssue({ id: issue.id }))}
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
              {comments.map((comment) => (
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
                    {comment.reactions.map((reaction) => (
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
