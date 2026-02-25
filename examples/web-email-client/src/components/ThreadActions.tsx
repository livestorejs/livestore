import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type React from 'react'
import { useState } from 'react'

import { useMailboxStore } from '../stores/mailbox'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread'
import { threadCommands, threadTables } from '../stores/thread/schema.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

type ThreadActionsProps = {
  threadId: string
}

const systemLabelsQuery = queryDb(mailboxTables.labels.where({ type: 'system' }), { label: 'systemLabels' })
const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })

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
  const threadLabels = threadStore.useQuery(threadLabelsQuery)
  const [conflictedTargetLabelName, setConflictedTargetLabelName] = useState<string>()

  const currentSystemLabel = threadLabels.find((tl) => systemLabels.some((sl) => sl.id === tl.labelId))

  function isSystemLabelApplied(labelName: string) {
    return !!systemLabels.find((l) => l.name === labelName && threadLabels.some((tl) => tl.labelId === l.id))
  }

  const moveToSystemLabel = async (targetLabelName: string) => {
    const targetLabel = systemLabels.find((l) => l.name === targetLabelName)
    if (!targetLabel) throw new Error(`${targetLabelName} label not found`)
    if (!currentSystemLabel) throw new Error('Thread has no system label applied')

    setConflictedTargetLabelName(undefined)

    const confirmation = await threadStore.execute(
      threadCommands.replaceLabel({
        threadId,
        currentLabelId: currentSystemLabel.labelId,
        targetLabelId: targetLabel.id,
        replacedAt: new Date(),
      }),
    ).confirmation

    if (confirmation._tag === 'conflict' && confirmation.error._tag === 'LabelNotOnThread') {
      setConflictedTargetLabelName(targetLabelName)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center space-x-2">
        <button
          onClick={() => moveToSystemLabel('ARCHIVE')}
          type="button"
          className="px-2 py-1 text-sm text-gray-600 hover:text-green-600 border rounded disabled:opacity-50"
          title="Archive thread"
          disabled={isSystemLabelApplied('ARCHIVE') === true}
        >
          Archive
        </button>

        <button
          onClick={() => moveToSystemLabel('TRASH')}
          type="button"
          className="px-2 py-1 text-sm text-gray-600 hover:text-red-600 border rounded disabled:opacity-50"
          title="Move to trash"
          disabled={isSystemLabelApplied('TRASH') === true}
        >
          Trash
        </button>

        <UserLabelPicker threadId={threadId} />
      </div>

      {conflictedTargetLabelName && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs bg-yellow-50 border border-yellow-200 rounded">
          <span className="text-yellow-800">
            Another client moved this thread. Move to {conflictedTargetLabelName.toLowerCase()} anyway?
          </span>
          <button
            onClick={() => moveToSystemLabel(conflictedTargetLabelName)}
            type="button"
            className="px-1.5 py-0.5 text-yellow-800 hover:text-yellow-900 border border-yellow-300 rounded bg-yellow-100"
          >
            Retry
          </button>
          <button
            onClick={() => setConflictedTargetLabelName(undefined)}
            type="button"
            className="px-1.5 py-0.5 text-yellow-600 hover:text-yellow-800"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
