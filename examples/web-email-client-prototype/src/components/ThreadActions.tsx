import type React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'
import { UserLabelPicker } from './UserLabelPicker.tsx'

/**
 * ThreadActions - Thread-level action buttons
 *
 * Provides:
 * - Archive/Trash actions
 * - User label management
 */

export const ThreadActions: React.FC = () => {
  const { getCurrentThread, trashThread, archiveThread } = useEmailStore()

  const currentThread = getCurrentThread()

  if (!currentThread) throw new Error('No current thread selected')

  return (
    <div className="flex items-center space-x-2">
      {/* Quick Actions */}
      <div className="flex items-center space-x-1">
        <button
          onClick={() => archiveThread(currentThread.id)}
          type="button"
          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          title="Archive thread"
        >
          🗄️
        </button>

        <button
          onClick={() => trashThread(currentThread.id)}
          type="button"
          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
          title="Move to trash"
        >
          🗑️
        </button>

        <UserLabelPicker threadId={currentThread.id} />
      </div>
    </div>
  )
}
