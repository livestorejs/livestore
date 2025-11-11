import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import type React from 'react'
import { useState } from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { applyUserLabelToThread, removeUserLabelFromThread } from '../stores/thread/commands.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { threadTables } from '../stores/thread/schema.ts'

type UserLabelPickerProps = {
  threadId: string
}

const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })
const userLabelsQuery = queryDb(mailboxTables.labels.where({ type: 'user' }), { label: 'userLabels' })

/**
 * Picker for applying/removing user labels from threads
 *
 * Features:
 * - Dropdown showing all available user labels
 * - Shows which labels are already applied
 * - Click to toggle label application
 */
export const UserLabelPicker: React.FC<UserLabelPickerProps> = ({ threadId }) => {
  const mailboxStore = useMailboxStore()
  const userLabels = mailboxStore.useQuery(userLabelsQuery)

  const threadStore = useStore(threadStoreOptions(threadId))
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  const isLabelApplied = (labelId: string) => threadLabels.some((tl) => tl.labelId === labelId)

  const threadUserLabels = userLabels.filter((l) => isLabelApplied(l.id))

  const [isOpen, setIsOpen] = useState(false)

  const toggleUserLabel = (labelId: string) => {
    if (isLabelApplied(labelId)) {
      removeUserLabelFromThread(threadStore, { threadId, labelId })
    } else {
      applyUserLabelToThread(threadStore, { threadId, labelId })
    }
  }

  if (userLabels.length === 0) return null // No user labels to show

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
        title="Apply labels"
      >
        🏷️
      </button>

      {/* Applied Labels Count */}
      {threadUserLabels.length > 0 && (
        <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
          {threadUserLabels.length}
        </span>
      )}

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <button
            type="button"
            className="fixed inset-0 z-10 bg-transparent border-none cursor-default"
            onClick={() => setIsOpen(false)}
            aria-label="Close dropdown"
          />

          {/* Dropdown Menu */}
          <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-20">
            <div className="py-1">
              <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200">Apply Labels</div>

              {userLabels.map((label) => {
                return (
                  <button
                    key={label.id}
                    onClick={() => toggleUserLabel(label.id)}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: label.color }} />
                      <span className="capitalize">{label.name}</span>
                    </div>

                    {isLabelApplied(label.id) && <span className="text-green-600 text-xs">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
