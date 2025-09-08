import type React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'
import { ComposeMessage } from './ComposeMessage.tsx'
import { MessageItem } from './MessageItem.tsx'
import { ThreadActions } from './ThreadActions.tsx'

/**
 * ThreadView - Display single email thread
 *
 * Shows:
 * - Thread header with subject and participants
 * - List of messages in chronological order
 * - Compose area for new messages
 * - Thread-level actions (labels, etc.)
 */

export const ThreadView: React.FC = () => {
  const { getCurrentThread, getMessagesForThread, getLabelsForThread, uiState, toggleComposing } = useEmailStore()

  const currentThread = getCurrentThread()
  const messages = currentThread ? getMessagesForThread(currentThread.id) : []
  const threadLabels = currentThread ? getLabelsForThread(currentThread.id) : []

  if (!currentThread) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2">📧</div>
          <p>No thread selected</p>
        </div>
      </div>
    )
  }

  const participants = JSON.parse(currentThread.participants) as string[]

  return (
    <div className="h-full flex flex-col">
      {/* Thread Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{currentThread.subject}</h3>
            <div className="flex items-center text-sm text-gray-600 space-x-4">
              <div>
                <span className="font-medium">Participants:</span> {participants.join(', ')}
              </div>
              <div>
                <span className="font-medium">Messages:</span> {messages.length}
              </div>
              <div>
                <span className="font-medium">Last activity:</span> {currentThread.lastActivity.toLocaleDateString()}
              </div>
            </div>

            {/* Thread Labels */}
            {threadLabels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {threadLabels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: `${label.color}20`,
                      color: label.color,
                    }}
                  >
                    {label.name}
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
              <ComposeMessage threadId={currentThread.id} />
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
