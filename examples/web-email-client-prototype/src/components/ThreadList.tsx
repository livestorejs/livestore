import type React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'

/**
 * ThreadList - Display list of threads for selected label
 *
 * Shows:
 * - List of threads with subject, participants, message count
 * - Click to select thread for detailed view
 * - Gmail-inspired thread list design
 */

export const ThreadList: React.FC = () => {
  const { getCurrentLabel, getThreadsForLabel, selectThread, getThreadMessageCount } = useEmailStore()

  const currentLabel = getCurrentLabel()
  const threads = currentLabel ? getThreadsForLabel(currentLabel.id) : []

  if (!currentLabel) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2">📧</div>
          <p>Select a label to view threads</p>
        </div>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2">📭</div>
          <p>
            No threads in{' '}
            <span className="font-medium text-gray-600 capitalize">{currentLabel.name.toLocaleLowerCase()}</span>
          </p>
          <p className="text-sm mt-1 text-gray-400">Threads will appear here when they have this label</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-white">
      {/* Thread List */}
      <div className="divide-y divide-gray-100">
        {threads.map((thread) => {
          const participants = JSON.parse(thread.participants) as string[]
          const messageCount = getThreadMessageCount(thread.id)

          return (
            <button
              key={thread.id}
              onClick={() => selectThread(thread.id)}
              type="button"
              className="w-full text-left px-6 py-4 hover:bg-gray-50 border-l-4 border-transparent hover:border-blue-400 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  {/* Thread Subject */}
                  <h3 className="text-sm font-medium mb-1 text-gray-900 truncate">{thread.subject}</h3>

                  {/* Participants */}
                  <p className="text-sm text-gray-600 truncate">
                    {participants.length > 2
                      ? `${participants.slice(0, 2).join(', ')} +${participants.length - 2} more`
                      : participants.join(', ')}
                  </p>

                  {/* Thread metadata */}
                  <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                    <span>{messageCount} messages</span>
                  </div>
                </div>

                <span className="text-xs text-gray-400">
                  {`${new Date(thread.lastActivity).toLocaleDateString(undefined, {
                    dateStyle: 'medium',
                  })} - ${new Date(thread.lastActivity).toLocaleTimeString(undefined, {
                    timeStyle: 'short',
                  })}`}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
