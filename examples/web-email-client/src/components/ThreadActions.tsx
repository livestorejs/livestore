import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { threadEvents, threadTables } from '../stores/thread/schema.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })

/**
 *  Thread-level action buttons
 *
 * Provides:
 * - Archive/Trash actions
 * - User label management
 */
export const ThreadActions: React.FC = () => {
  const mailboxStore = useMailboxStore()
  const [uiState] = mailboxStore.useClientDocument(mailboxTables.uiState)
  const selectedThreadId = uiState.selectedThreadId

  if (!selectedThreadId) throw new Error('No current thread selected')

  const threadStore = useStore(threadStoreOptions(selectedThreadId))
  const labels = mailboxStore.useQuery(labelsQuery)
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  const getLabelsForThread = (threadId: string) => {
    const labelIds = threadLabels.filter((tl) => tl.threadId === threadId).map((tl) => tl.labelId)
    return labels.filter((l) => labelIds.includes(l.id))
  }

  const getSystemLabelForThread = (threadId: string) => {
    const threadLabelsForThread = getLabelsForThread(threadId)
    const systemLabels = threadLabelsForThread.filter((l) => l.type === 'system')
    return systemLabels[0] || null
  }

  const trashThread = (threadId: string) => {
    if (!threadStore) return

    const trashLabel = labels.find((l) => l.name === 'TRASH')
    if (!trashLabel) {
      console.error('Trash label not found')
      return
    }

    const currentSystemLabel = getSystemLabelForThread(threadId)

    try {
      const eventsToCommit = []

      if (currentSystemLabel && currentSystemLabel.id !== trashLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      if (!currentSystemLabel || currentSystemLabel.id !== trashLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelApplied({
            threadId,
            labelId: trashLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      if (eventsToCommit.length > 0) {
        threadStore.commit(...eventsToCommit)
      }
    } catch (error) {
      console.error('Failed to trash thread:', error)
    }
  }

  const archiveThread = (threadId: string) => {
    if (!threadStore) return

    const archiveLabel = labels.find((l) => l.name === 'ARCHIVE')
    if (!archiveLabel) {
      console.error('Archive label not found')
      return
    }

    const currentSystemLabel = getSystemLabelForThread(threadId)

    try {
      const eventsToCommit = []

      if (currentSystemLabel && currentSystemLabel.id !== archiveLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      if (!currentSystemLabel || currentSystemLabel.id !== archiveLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelApplied({
            threadId,
            labelId: archiveLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      if (eventsToCommit.length > 0) {
        threadStore.commit(...eventsToCommit)
      }
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
