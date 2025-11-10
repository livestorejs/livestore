import type React from 'react'
import { useMailbox } from '../hooks/useMailbox.ts'
import { useThread } from '../hooks/useThread.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

/**
 * ThreadActions - Thread-level action buttons
 *
 * Provides:
 * - Archive/Trash actions
 * - User label management
 */

export const ThreadActions: React.FC = () => {
  const { selectedThreadId } = useMailbox()

  if (!selectedThreadId) throw new Error('No current thread selected')

  const { trashThread, archiveThread } = useThread(selectedThreadId)

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
