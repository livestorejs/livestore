import type React from 'react'
import { useActionState } from 'react'

import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'

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

  const currentSystemLabel = threadLabels.find((tl) => systemLabels.some((sl) => sl.id === tl.labelId))
  if (!currentSystemLabel) throw new Error('Thread has no system label applied')

  function isSystemLabelApplied(labelName: string) {
    return !!systemLabels.find((l) => l.name === labelName && threadLabels.some((tl) => tl.labelId === l.id))
  }

  const [conflictedTargetLabelName, moveToSystemLabel] = useActionState(
    async (_prev: string | undefined, formData: FormData): Promise<string | undefined> => {
      const targetLabelName = formData.get('targetLabelName')
      if (typeof targetLabelName !== 'string') throw new Error('Label is not a string')

      if (targetLabelName === '[[dismiss]]') return undefined // Handles dismissal

      const targetLabel = systemLabels.find((l) => l.name === targetLabelName)
      if (!targetLabel) throw new Error(`${targetLabelName} label is not a valid system label`)

      const confirmation = await threadStore.execute(
        threadCommands.replaceLabel({
          threadId,
          currentLabelId: currentSystemLabel.labelId,
          targetLabelId: targetLabel.id,
          replacedAt: new Date(),
        }),
      ).confirmation

      if (confirmation._tag === 'conflict' && confirmation.error._tag === 'LabelNotOnThread') {
        // Conflict detected, return the label name to enable the user to retry
        return targetLabelName
      }
      return undefined
    },
    undefined,
  )


  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <form action={moveToSystemLabel} className="contents">
          <button
            type="submit"
            name="targetLabelName"
            value="ARCHIVE"
            className="px-2 py-1 text-sm text-gray-600 hover:text-green-600 border rounded disabled:opacity-50"
            disabled={isSystemLabelApplied('ARCHIVE') === true}
          >
            Archive
          </button>

          <button
            type="submit"
            name="targetLabelName"
            value="TRASH"
            className="px-2 py-1 text-sm text-gray-600 hover:text-red-600 border rounded disabled:opacity-50"
            disabled={isSystemLabelApplied('TRASH') === true}
          >
            Trash
          </button>
        </form>

        <UserLabelPicker threadId={threadId} />
      </div>

      {conflictedTargetLabelName && (
        <form action={moveToSystemLabel} className="flex items-center gap-2 px-2 py-1 text-xs bg-yellow-50">
          <p className="text-yellow-800">
            Another client moved this thread. Move to <strong className="capitalize">{conflictedTargetLabelName.toLowerCase()}</strong> anyway?
          </p>
          <div className="flex items-center">
            <button
              type="submit"
              name="targetLabelName"
              value={conflictedTargetLabelName}
              className="px-1 py-0.5 text-yellow-800 hover:text-yellow-900 border border-yellow-300 rounded bg-yellow-100 hover:bg-yellow-200"
            >
              Retry
            </button>
            <button
              type="submit"
              name="targetLabelName"
              value="[[dismiss]]"
              className="px-1.5 py-0.5 text-yellow-600 hover:text-yellow-900"
            >
              Dismiss
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
