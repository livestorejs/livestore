import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { threadTables } from '../stores/thread/schema.ts'
import { Message } from './Message.tsx'
import { ThreadActions } from './ThreadActions.tsx'

type ThreadViewProps = {
  threadId: string
}

const threadQuery = queryDb(threadTables.thread, { label: 'thread' })
const messagesQuery = queryDb(threadTables.messages.where({}), { label: 'messages' })
const userLabelsQuery = queryDb(mailboxTables.labels.where({ type: 'user' }), { label: 'userLabels' })
const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })

/**
 * Displays single email thread
 *
 * Shows:
 * - Thread header with subject and participants
 * - List of messages in chronological order
 * - Thread-level actions (labels, etc.)
 */
export const ThreadView: React.FC<ThreadViewProps> = ({ threadId }) => {
  const mailboxStore = useMailboxStore()
  const threadStore = useStore(threadStoreOptions(threadId))

  const userLabels = mailboxStore.useQuery(userLabelsQuery)
  const [thread] = threadStore.useQuery(threadQuery)
  const messages = threadStore.useQuery(messagesQuery)
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  const isLabelApplied = (labelId: string) => threadLabels.some((tl) => tl.labelId === labelId)
  const threadUserLabels = userLabels.filter((l) => isLabelApplied(l.id))
  const participants = JSON.parse(thread.participants) as string[]

  return (
    <div className="h-full flex flex-col">
      {/* Thread Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-1">{thread.subject}</h3>
            <div className="text-sm text-gray-600">{participants.join(', ')}</div>

            {threadUserLabels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {threadUserLabels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center px-2 py-1 rounded text-xs"
                    style={{
                      backgroundColor: label.color ? `${label.color}20` : undefined,
                      color: label.color ?? undefined,
                    }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <ThreadActions threadId={threadId} />
        </div>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto max-w-4xl mx-auto py-6 px-6 space-y-6">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>
    </div>
  )
}
