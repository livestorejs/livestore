import { queryDb, Schema, sql } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import React from 'react'
import { Avatar } from '@/components/common/avatar'
import { useFrontendState } from '@/lib/livestore/queries'
import { events, tables } from '@/lib/livestore/schema'
import { formatDate } from '@/utils/format-date'

export const Comments = ({ issueId }: { issueId: number }) => {
  const { store } = useStore()
  const [frontendState] = useFrontendState()
  const [pickerForComment, setPickerForComment] = React.useState<string | null>(null)
  const comments = store.useQuery(
    queryDb(
      {
        query: sql`
          SELECT 
            c.*,
            (
              SELECT COALESCE(
                json_group_array(json_object(
                  'id', r.id,
                  'emoji', r.emoji
                )), '[]'
              )
              FROM reaction r
              WHERE r.commentId = c.id
            ) as reactions
          FROM comment c
          WHERE c.issueId = ${issueId}
          GROUP BY c.id
          ORDER BY c.created DESC
        `,
        schema: tables.comment.rowSchema.pipe(
          Schema.extend(
            Schema.Struct({
              reactions: Schema.parseJson(Schema.Array(Schema.Struct({ id: Schema.String, emoji: Schema.String }))),
            }),
          ),
          Schema.Array,
        ),
      },
      { deps: [issueId] },
    ),
  )

  return (
    <ul className="mt-4 flex flex-col gap-4">
      {comments.map(({ id, body, creator, created, reactions }) => (
        <li
          key={id}
          className="bg-white dark:bg-neutral-800 border border-transparent dark:border-neutral-700/50 rounded-lg shadow p-4"
        >
          <div className="flex items-center -ml-0.5 -mt-0.5 mb-2 text-sm">
            <Avatar name={creator} />
            <div className="font-medium ml-2.5 mr-2">{creator}</div>
            {/* TODO: make this a relative date */}
            <div className="text-neutral-500 dark:text-neutral-400">{formatDate(new Date(created))}</div>
          </div>
          <div className="text-neutral-600 dark:text-neutral-200 font-normal mb-3 whitespace-pre-wrap">
            {stripHtml(body)}
          </div>
          <div className="flex items-center gap-2 mt-0">
            {reactions.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-neutral-200 dark:bg-neutral-700"
              >
                {r.emoji} 1
              </span>
            ))}
            <button
              type="button"
              className="text-xs text-neutral-600 dark:text-neutral-300 hover:underline"
              onClick={() => setPickerForComment((c) => (c === id ? null : id))}
            >
              + Add reaction
            </button>
          </div>

          {pickerForComment === id ? (
            <div className="flex items-center gap-2 mt-2">
              {['👍', '👎', '💯', '👀', '🤔', '✅', '🔥'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-neutral-200 dark:bg-neutral-700"
                  onClick={() => {
                    store.commit(
                      events.reactionCreated({
                        id: crypto.randomUUID(),
                        issueId: String(issueId),
                        commentId: id,
                        userId: slugifyUser(frontendState.user),
                        emoji,
                      }),
                    )
                    setPickerForComment(null)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

const slugifyUser = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') || 'default-user'

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, '')
