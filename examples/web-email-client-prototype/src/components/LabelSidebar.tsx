import type React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'
import { toSentenceCase } from '../utils.ts'

/**
 * LabelSidebar - System labels navigation
 *
 * Displays:
 * - System labels (INBOX, SENT, ARCHIVE, TRASH)
 * - Message counts per label
 * - Active label highlighting
 */

const labelIcons: Record<string, string> = {
  INBOX: '📥',
  SENT: '➡️',
  ARCHIVE: '🗄️',
  TRASH: '🗑️',
}

export const LabelSidebar: React.FC = () => {
  const { labels, uiState, selectLabel } = useEmailStore()

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
                <span className="font-medium">{toSentenceCase(label.name)}</span>
              </div>

              {/* Message Count */}
              {label.messageCount > 0 && (
                <span
                  className={`
                    text-xs px-2 py-1 rounded-full font-medium
                    ${isActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'}
                  `}
                >
                  {label.messageCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
