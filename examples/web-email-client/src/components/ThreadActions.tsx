import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { threadEvents, threadTables } from '../stores/thread/schema.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

const systemLabelsQuery = queryDb(mailboxTables.labels.where({ type: 'system' }), { label: 'systemLabels' })
const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })

/**
 * Thread-level action buttons
 *
 * Provides:
 * - Archive/Trash actions
 * - User label management
 */
export const ThreadActions: React.FC = () => {
  const mailboxStore = useMailboxStore()
  const [uiState] = mailboxStore.useClientDocument(mailboxTables.uiState)
  const selectedThreadId = uiState.selectedThreadId

  if (!selectedThreadId) throw new Error('No thread selected')

  const threadStore = useStore(threadStoreOptions(selectedThreadId))
  const systemLabels = mailboxStore.useQuery(systemLabelsQuery)
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  const isLabelApplied = (labelId: string) => threadLabels.some((tl) => tl.labelId === labelId)
  const threadSystemLabels = systemLabels.filter((l) => isLabelApplied(l.id))
  if (threadSystemLabels.length !== 1) throw new Error('Thread must have exactly one system label applied')
  const currentSystemLabel = threadSystemLabels[0]

  const trashThread = (threadId: string) => {
    const trashLabel = systemLabels.find((l) => l.name === 'TRASH')
    if (!trashLabel) throw new Error('TRASH label not found')

    const now = new Date()
    try {
      threadStore.commit(
        threadEvents.threadLabelRemoved({
          threadId,
          labelId: currentSystemLabel.id,
          removedAt: now,
        }),
        threadEvents.threadLabelApplied({
          threadId,
          labelId: trashLabel.id,
          appliedAt: now,
        }),
      )
    } catch (error) {
      console.error('Failed to trash thread:', error)
    }
  }

  const archiveThread = (threadId: string) => {
    const archiveLabel = systemLabels.find((l) => l.name === 'ARCHIVE')
    if (!archiveLabel) throw new Error('ARCHIVE label not found')

    const now = new Date()
    try {
      threadStore.commit(
        threadEvents.threadLabelRemoved({
          threadId,
          labelId: currentSystemLabel.id,
          removedAt: now,
        }),
        threadEvents.threadLabelApplied({
          threadId,
          labelId: archiveLabel.id,
          appliedAt: now,
        }),
      )
    } catch (error) {
      console.error('Failed to archive thread:', error)
    }
  }

  return (
    <div className="flex items-center space-x-2">
      {/* Quick Actions */}
      <div className="flex items-center space-x-1">
        <button
          onClick={() => archiveThread(selectedThreadId)}
          type="button"
          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          title="Archive thread"
        >
          🗄️
        </button>

        <button
          onClick={() => trashThread(selectedThreadId)}
          type="button"
          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
          title="Move to trash"
        >
          🗑️
        </button>

        <UserLabelPicker threadId={selectedThreadId} />
      </div>
    </div>
  )
}
