import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import type React from 'react'
import { useMemo } from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { threadEvents, threadTables } from '../stores/thread/schema.ts'
import { ComposeMessage } from './ComposeMessage.tsx'
import { MessageItem } from './MessageItem.tsx'
import { ThreadActions } from './ThreadActions.tsx'

type ThreadViewProps = {
  threadId: string
}

const threadQuery = queryDb(threadTables.thread, { label: 'thread' })
const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })

// Parameterized query for messages filtered by threadId
const createMessagesForThreadQuery = (threadId: string) =>
  queryDb(threadTables.messages.where({ threadId }).orderBy('timestamp', 'asc'), {
    label: 'messagesForThread',
    deps: [threadId],
  })

/**
 * Display single email thread
 *
 * Shows:
 * - Thread header with subject and participants
 * - List of messages in chronological order
 * - Compose area for new messages
 * - Thread-level actions (labels, etc.)
 */
export const ThreadView: React.FC<ThreadViewProps> = ({ threadId }) => {
  const mailboxStore = useMailboxStore()
  const [uiState, setUiState] = mailboxStore.useClientDocument(mailboxTables.uiState)

  const toggleComposing = () => {
    setUiState({ isComposing: !uiState.isComposing })
  }

  const threadStore = useStore(threadStoreOptions(threadId))
  const [thread] = threadStore.useQuery(threadQuery)
  const labels = mailboxStore.useQuery(labelsQuery)
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  // Use parameterized query for messages (filtered and sorted by SQLite)
  const messagesQuery = useMemo(() => createMessagesForThreadQuery(threadId), [threadId])
  const messages = threadStore.useQuery(messagesQuery)

  const getLabelsForThread = (threadId: string) => {
    const labelIds = threadLabels.filter((tl) => tl.threadId === threadId).map((tl) => tl.labelId)
    return labels.filter((l) => labelIds.includes(l.id))
  }

  const getUserLabelsForThread = (threadId: string) => {
    const allLabels = getLabelsForThread(threadId)
    return allLabels.filter((l) => l.type === 'user')
  }

  const removeUserLabelFromThread = (threadId: string, labelId: string) => {
    if (!threadStore) return

    const targetLabel = labels.find((l) => l.id === labelId)
    if (!targetLabel) {
      console.error('Target label not found')
      return
    }

    if (targetLabel.type !== 'user') {
      console.error('Can only remove user labels with this function')
      return
    }

    const isLabelApplied = getLabelsForThread(threadId).some((l) => l.id === labelId)
    if (!isLabelApplied) return

    try {
      threadStore.commit(
        threadEvents.threadLabelRemoved({
          threadId,
          labelId: targetLabel.id,
          removedAt: new Date(),
        }),
      )
    } catch (error) {
      console.error(`Failed to remove user label ${targetLabel.name} from thread:`, error)
    }
  }

  const threadUserLabels = getUserLabelsForThread(threadId)

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2">📧</div>
          <p>No thread selected</p>
        </div>
      </div>
    )
  }

  const participants = JSON.parse(thread.participants) as string[]

  return (
    <div className="h-full flex flex-col">
      {/* Thread Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{thread.subject}</h3>
            <div className="flex items-center text-sm text-gray-600 space-x-4">
              <div>
                <span className="font-medium">Participants:</span> {participants.join(', ')}
              </div>
              <div>
                <span className="font-medium">Messages:</span> {messages.length}
              </div>
              <div>
                <span className="font-medium">Last activity:</span> {thread.lastActivity.toLocaleDateString()}
              </div>
            </div>

            {threadUserLabels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {threadUserLabels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: `${label.color}20`,
                      color: label.color,
                    }}
                  >
                    {label.name}
                    <button
                      onClick={() => removeUserLabelFromThread(thread.id, label.id)}
                      type="button"
                      className="ml-1 hover:bg-black hover:bg-opacity-20 rounded-full p-0.5 transition-colors"
                      title={`Remove ${label.name} label`}
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <title>Remove label</title>
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <ThreadActions />
        </div>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto py-6 px-6">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-gray-500">No messages in this thread</p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  isFirst={index === 0}
                  isLast={index === messages.length - 1}
                />
              ))}
            </div>
          )}

          {/* Compose Area */}
          {uiState.isComposing && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <ComposeMessage threadId={thread.id} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Actions */}
      {!uiState.isComposing && (
        <div className="bg-white border-t border-gray-200 px-6 py-4">
          <div className="max-w-4xl mx-auto">
            <button
              onClick={toggleComposing}
              type="button"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <span className="mr-2">✏️</span>
              Reply to thread
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
