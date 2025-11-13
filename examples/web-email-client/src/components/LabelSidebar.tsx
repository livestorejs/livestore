import { queryDb } from '@livestore/livestore'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })

/**
 * Thread labels navigation sidebar
 *
 * Displays:
 * - System labels (INBOX, SENT, ARCHIVE, TRASH)
 * - Custom user labels
 * - Thread counts per label
 * - Active label highlighting
 */
export const LabelSidebar: React.FC = () => {
  const mailboxStore = useMailboxStore()

  const [uiState, setUiState] = mailboxStore.useClientDocument(mailboxTables.uiState)
  const labels = mailboxStore.useQuery(labelsQuery)

  const selectLabel = (labelId: string) => {
    setUiState({ selectedLabelId: labelId, selectedThreadId: null })
  }

  return (
    <nav className="p-4 space-y-1">
      {labels.map((label) => {
        const isActive = uiState.selectedLabelId === label.id

        return (
          <button
            key={label.id}
            type="button"
            onClick={() => selectLabel(label.id)}
            className={`w-full text-left px-3 py-2 rounded text-sm font-medium flex items-center text-gray-700 justify-between ${isActive ? 'bg-gray-200' : ' hover:bg-gray-100'}`}
          >
            <div className="flex items-center gap-2">
              <div className="w-3 flex-shrink-0">
                {label.color && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: label.color }} />}
              </div>
              <span className="capitalize">{label.name.toLocaleLowerCase()}</span>
            </div>

            {label.threadCount > 0 && (
              <span className={`text-xs px-2 py-1 rounded ${isActive ? 'bg-gray-300' : 'bg-gray-200'}`}>
                {label.threadCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
