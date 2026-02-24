import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type React from 'react'

import { useMailboxStore } from '../stores/mailbox'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread'
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

  const moveToSystemLabel = async (labelName: string) => {
    const label = systemLabels.find((l) => l.name === labelName)
    if (!label) throw new Error(`${labelName} label not found`)

    const confirmation = await threadStore.execute(
      commands.replaceLabel({
        threadId,
        currentLabelId: label.id,
        targetLabelId: label.id,
        replacedAt: new Date(),
      }),
    ).confirmation
    if (confirmation._tag === 'conflict' && confirmation.error._tag === 'LabelNotOnThread') {
      // TODO
    }
  }

  return (
    <div className="flex items-center space-x-2">
      <button
        onClick={() => moveToSystemLabel('ARCHIVE')}
        type="button"
        className="px-2 py-1 text-sm text-gray-600 hover:text-green-600 border rounded"
        title="Archive thread"
      >
        Archive
      </button>

      <button
        onClick={() => moveToSystemLabel('TRASH')}
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
