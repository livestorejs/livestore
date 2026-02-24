import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type React from 'react'
import { useState } from 'react'

import { useMailboxStore } from '../stores/mailbox'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread'
import { commands, threadTables } from '../stores/thread/schema.ts'

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
  const threadStore = useStore(threadStoreOptions(threadId))

  const labels = mailboxStore.useQuery(userLabelsQuery)
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  const [isOpen, setIsOpen] = useState(false)

  const isLabelApplied = (labelId: string) => threadLabels.some((tl) => tl.labelId === labelId)
  const appliedLabels = labels.filter((l) => isLabelApplied(l.id))
  const labelDotStyles = new Map(
    labels.map((label) => [label.id, { backgroundColor: label.color ?? undefined }]),
  )

  const toggleLabel = (labelId: string) => {
    if (isLabelApplied(labelId)) {
      threadStore.execute(commands.removeLabel({ threadId, labelId, removedAt: new Date() }))
    } else {
      threadStore.execute(commands.applyLabel({ threadId, labelId, appliedAt: new Date() }))
    }
  }

  if (labels.length === 0) return null // No labels to show

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen((open) => !open)}
        type="button"
        className="px-2 py-1 text-sm text-gray-600 hover:text-black border rounded"
        title="Apply labels"
      >
        Labels {appliedLabels.length > 0 && `(${appliedLabels.length})`}
      </button>

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
          <div className="absolute right-0 mt-1 w-48 bg-white rounded shadow border z-20">
            {labels.map((label) => {
              return (
                <button
                  key={label.id}
                  data-label-id={label.id}
                  onClick={(e) => {
                    const labelId = e.currentTarget.dataset.labelId
                    if (labelId === undefined) throw new Error('No label ID found')
                    toggleLabel(labelId)
                  }}
                  type="button"
                  className="w-full text-left rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-between"
                >
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full mr-2" style={labelDotStyles.get(label.id)} />
                    <span className="capitalize">{label.name}</span>
                  </div>

                  {isLabelApplied(label.id) && <span className="text-xs font-bold">✓</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
