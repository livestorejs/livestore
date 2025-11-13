import { useStore } from '@livestore/react/experimental'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { archiveThread, trashThread } from '../stores/thread/commands.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

type ThreadActionsProps = {
  threadId: string
}

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

  return (
    <div className="flex items-center space-x-2">
      <button
        onClick={() => archiveThread(threadStore, mailboxStore, { threadId })}
        type="button"
        className="px-2 py-1 text-sm text-gray-600 hover:text-green-600 border rounded"
        title="Archive thread"
      >
        Archive
      </button>

      <button
        onClick={() => trashThread(threadStore, mailboxStore, { threadId })}
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
