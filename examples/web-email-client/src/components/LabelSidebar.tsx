import { queryDb } from '@livestore/livestore'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'

const labelIcons: Record<string, string> = {
  INBOX: '📥',
  SENT: '➡️',
  ARCHIVE: '🗄️',
  TRASH: '🗑️',
}

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
    <div className="p-4">
      <nav className="space-y-1">
        {labels.map((label) => {
          const isActive = uiState.selectedLabelId === label.id

          return (
            <button
              key={label.id}
              type="button"
              onClick={() => selectLabel(label.id)}
              className={`
                w-full text-left px-3 py-2 rounded-md text-sm font-medium
                transition-colors duration-150 flex items-center justify-between
                ${isActive ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'text-gray-700 hover:bg-gray-100'}
              `}
            >
              <div className="flex items-center">
                <span className="mr-3 text-lg">{labelIcons[label.name] || '🏷️'}</span>
                <span className="font-medium capitalize">{label.name.toLocaleLowerCase()}</span>
              </div>

              {/* Thread Count */}
              {label.threadCount > 0 && (
                <span
                  className={`
                    text-xs px-2 py-1 rounded-full font-medium
                    ${isActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'}
                  `}
                >
                  {label.threadCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
