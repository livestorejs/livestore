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
    <div className="flex items-center space-x-1">
      <button
        onClick={() => archiveThread(threadStore, mailboxStore, { threadId })}
        type="button"
        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
        title="Archive thread"
      >
        🗄️
      </button>

      <button
        onClick={() => trashThread(threadStore, mailboxStore, { threadId })}
        type="button"
        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
        title="Move to trash"
      >
        🗑️
      </button>

      <UserLabelPicker threadId={threadId} />
    </div>
  )
}
