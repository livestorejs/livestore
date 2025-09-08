import React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'

/**
 * ThreadActions - Thread-level action buttons
 *
 * Provides:
 * - Label apply/remove actions (demonstrates cross-aggregate events)
 * - Archive/Delete actions
 * - Thread management controls
 */

export const ThreadActions: React.FC = () => {
  const { getCurrentThread, getLabelsForThread, systemLabels, applyLabelToThread, removeLabelFromThread } =
    useEmailStore()

  const [showLabelMenu, setShowLabelMenu] = React.useState(false)
  const currentThread = getCurrentThread()
  const appliedLabels = currentThread ? getLabelsForThread(currentThread.id) : []

  if (!currentThread) return null

  const handleLabelToggle = (labelId: string) => {
    const isApplied = appliedLabels.some((l) => l.id === labelId)

    if (isApplied) {
      removeLabelFromThread(currentThread.id, labelId)
    } else {
      applyLabelToThread(currentThread.id, labelId)
    }

    setShowLabelMenu(false)
  }

  return (
    <div className="flex items-center space-x-2">
      {/* Label Management Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowLabelMenu(!showLabelMenu)}
          className="flex items-center px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          <span className="mr-1">🏷️</span>
          Labels
          <span className="ml-1 text-xs">▼</span>
        </button>

        {showLabelMenu && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-10" onClick={() => setShowLabelMenu(false)} />

            {/* Menu */}
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-20">
              <div className="p-2">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 px-2">
                  System Labels
                </div>

                {systemLabels.map((label) => {
                  const isApplied = appliedLabels.some((l) => l.id === label.id)

                  return (
                    <button
                      key={label.id}
                      onClick={() => handleLabelToggle(label.id)}
                      className={`
                        w-full text-left px-2 py-1 rounded text-sm
                        flex items-center justify-between
                        transition-colors hover:bg-gray-100
                        ${isApplied ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}
                      `}
                    >
                      <span className="flex items-center">
                        <span className="mr-2">
                          {label.id === 'inbox' && '📥'}
                          {label.id === 'sent' && '📤'}
                          {label.id === 'archive' && '📦'}
                          {label.id === 'trash' && '🗑️'}
                        </span>
                        {label.name}
                      </span>

                      {isApplied && <span className="text-blue-600">✓</span>}
                    </button>
                  )
                })}
              </div>

              <div className="border-t border-gray-200 p-2">
                <div className="text-xs text-gray-500 px-2">💡 Label changes trigger cross-aggregate events</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex items-center space-x-1">
        <button
          onClick={() => handleLabelToggle('archive')}
          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          title="Archive thread"
        >
          📦
        </button>

        <button
          onClick={() => handleLabelToggle('trash')}
          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
          title="Move to trash"
        >
          🗑️
        </button>
      </div>

      {/* Applied Labels Display */}
      {appliedLabels.length > 0 && (
        <div className="flex items-center space-x-1 ml-3">
          <span className="text-xs text-gray-500">Applied:</span>
          {appliedLabels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
          {appliedLabels.length > 3 && <span className="text-xs text-gray-500">+{appliedLabels.length - 3} more</span>}
        </div>
      )}
    </div>
  )
}
