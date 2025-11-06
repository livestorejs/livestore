import type React from 'react'
import { useInbox } from '../hooks/useInbox.ts'

/**
 * ThreadList - Display list of threads for selected label
 *
 * Shows:
 * - List of threads with subject, participants, last activity
 * - Click to select thread for detailed view
 * - Gmail-inspired thread list design
 *
 * Uses Labels aggregate projections (threadIndex + threadLabels) for efficient querying
 */

export const ThreadList: React.FC = () => {
  const { currentLabel, selectThread, threadIndex, threadLabels } = useInbox()

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

  console.log('threadIndex:', threadIndex)

  // Filter threads by current label using Labels aggregate projections
  const getThreadsForLabel = (labelId: string) => {
    const threadIds = threadLabels.filter((tl) => tl.labelId === labelId).map((tl) => tl.threadId)
    return threadIndex.filter((t) => threadIds.includes(t.id))
  }
  const threadsForLabel = getThreadsForLabel(currentLabel.id)

  if (threadsForLabel.length === 0) {
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
        {threadsForLabel.map((thread) => {
          const participants = JSON.parse(thread.participants) as string[]

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
