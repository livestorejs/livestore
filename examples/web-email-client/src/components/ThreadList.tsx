import { queryDb } from '@livestore/livestore'
import { useStoreRegistry } from '@livestore/react/experimental'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadIndexQuery = queryDb(mailboxTables.threadIndex.where({}), { label: 'threadIndex' })

/**
 * Displays list of threads for selected label
 *
 * - List of threads with subject, participants, last activity
 * - Click to select thread for detailed view
 * - Preloads thread store on hover/focus for faster loading
 */
export const ThreadList: React.FC = () => {
  const storeRegistry = useStoreRegistry()
  const mailboxStore = useMailboxStore()

  const labels = mailboxStore.useQuery(labelsQuery)
  const threadIndex = mailboxStore.useQuery(threadIndexQuery)
  const [uiState, setUiState] = mailboxStore.useClientDocument(mailboxTables.uiState)
  const threadLabelsForLabel = mailboxStore.useQuery(
    queryDb(mailboxTables.threadLabels.where({ labelId: uiState.selectedLabelId || '' }), {
      label: 'threadLabelsForLabel',
      deps: [uiState.selectedLabelId],
    }),
  )

  const selectedLabel = labels.find((l) => l.id === uiState.selectedLabelId)
  if (!selectedLabel) throw new Error('ThreadList rendered without a selected label or selected label not found')

  const threadsForSelectedLabel = uiState.selectedLabelId
    ? threadLabelsForLabel
        .map((tl) => threadIndex.find((t) => t.id === tl.threadId))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
    : undefined

  if (!threadsForSelectedLabel || threadsForSelectedLabel.length === 0) {
    return (
      <div className="grid place-items-center h-full">
        <p className="text-gray-500">
          No threads in{' '}
          <span className="font-medium text-gray-700 capitalize">{selectedLabel.name.toLocaleLowerCase()}</span>
        </p>
      </div>
    )
  }

  const selectThread = (threadId: string) => {
    setUiState({ selectedThreadId: threadId })
  }

  const preloadThreadStore = (threadId: string) => {
    void storeRegistry.preload(threadStoreOptions(threadId))
  }

  return (
    <div className="divide-y h-full bg-white divide-gray-100">
      {threadsForSelectedLabel.map((thread) => {
        const participants = JSON.parse(thread.participants) as string[]

        return (
          <button
            key={thread.id}
            onMouseEnter={() => preloadThreadStore(thread.id)}
            onFocus={() => preloadThreadStore(thread.id)}
            onClick={() => selectThread(thread.id)}
            type="button"
            className="w-full text-left px-6 py-4 hover:bg-gray-50 border-l-2 border-transparent hover:border-gray-400"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium mb-1 truncate">{thread.subject}</h3>
                <p className="text-sm text-gray-600 truncate">{participants.join(', ')}</p>
              </div>

              <span className="text-xs text-gray-400">{new Date(thread.lastActivity).toLocaleDateString()}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
