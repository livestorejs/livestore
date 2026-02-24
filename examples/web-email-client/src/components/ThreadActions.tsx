import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type React from 'react'
import { useCallback } from 'react'

import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { commands } from '../stores/thread/schema.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

type ThreadActionsProps = {
  threadId: string
}

const systemLabelsQuery = queryDb(mailboxTables.labels.where({ type: 'system' }), { label: 'systemLabels' })

/**
 * Thread-level action buttons
 *
 * Provides:
 * - Archive/Trash actions
 * - User label management
 */
export const ThreadActions: React.FC<ThreadActionsProps> = ({ threadId }) => {
  const mailboxStore = useMailboxStore()
  const threadStore = useStore(threadStoreOptions(threadId))
  const systemLabels = mailboxStore.useQuery(systemLabelsQuery)

  const handleArchive = useCallback(() => {
    const archiveLabel = systemLabels.find((l) => l.name === 'ARCHIVE')
    if (!archiveLabel) throw new Error('ARCHIVE label not found')

    threadStore.execute(
      commands.moveThreadToSystemLabel({
        threadId,
        targetLabelId: archiveLabel.id,
        systemLabelIds: systemLabels.map((l) => l.id),
        movedAt: new Date(),
      }),
    )
  }, [systemLabels, threadId, threadStore])

  const handleTrash = useCallback(() => {
    const trashLabel = systemLabels.find((l) => l.name === 'TRASH')
    if (!trashLabel) throw new Error('TRASH label not found')

    threadStore.execute(
      commands.moveThreadToSystemLabel({
        threadId,
        targetLabelId: trashLabel.id,
        systemLabelIds: systemLabels.map((l) => l.id),
        movedAt: new Date(),
      }),
    )
  }, [systemLabels, threadId, threadStore])

  return (
    <div className="flex items-center space-x-2">
      <button
        onClick={handleArchive}
        type="button"
        className="px-2 py-1 text-sm text-gray-600 hover:text-green-600 border rounded"
        title="Archive thread"
      >
        Archive
      </button>

      <button
        onClick={handleTrash}
        type="button"
        className="px-2 py-1 text-sm text-gray-600 hover:text-red-600 border rounded"
        title="Move to trash"
      >
        Trash
      </button>

      <UserLabelPicker threadId={threadId} />
    </div>
  )
}
