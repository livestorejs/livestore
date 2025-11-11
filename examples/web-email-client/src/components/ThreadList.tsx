import { queryDb } from '@livestore/livestore'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadIndexQuery = queryDb(mailboxTables.threadIndex.where({}), { label: 'threadIndex' })
const threadLabelsQuery = queryDb(mailboxTables.threadLabels.where({}), { label: 'threadLabels' })

/**
 * Displays list of threads for selected label
 *
 * Shows:
 * - List of threads with subject, participants, last activity
 * - Click to select thread for detailed view
 * - Gmail-inspired thread list design
 */
export const ThreadList: React.FC = () => {
  const mailboxStore = useMailboxStore()
  const [uiState, setUiState] = mailboxStore.useClientDocument(mailboxTables.uiState)
  const labels = mailboxStore.useQuery(labelsQuery)
  const threadIndex = mailboxStore.useQuery(threadIndexQuery)
  const threadLabels = mailboxStore.useQuery(threadLabelsQuery)

  const selectThread = (threadId: string | null) => {
    setUiState({ selectedThreadId: threadId })
  }

  const selectedLabel = labels.find((l) => l.id === uiState.selectedLabelId)
  const threadsForSelectedLabel = selectedLabel
    ? threadLabels
        .filter((tl) => tl.labelId === selectedLabel.id)
        .map((tl) => threadIndex.find((t) => t.id === tl.threadId))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
    : undefined

  if (!selectedLabel) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2">📧</div>
          <p>Select a label to view threads</p>
        </div>
      </div>
    )
  }

  if (!threadsForSelectedLabel || threadsForSelectedLabel.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2">📭</div>
          <p>
            No threads in{' '}
            <span className="font-medium text-gray-600 capitalize">{selectedLabel.name.toLocaleLowerCase()}</span>
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
        {threadsForSelectedLabel.map((thread) => {
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
