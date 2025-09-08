import React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'

/**
 * ComposeMessage - New message composition interface
 *
 * Features:
 * - Text area for message content
 * - Send/Cancel actions
 * - Draft saving (UI state)
 * - Real-time draft persistence
 */

interface ComposeMessageProps {
  threadId: string
}

export const ComposeMessage: React.FC<ComposeMessageProps> = ({ threadId }) => {
  const { uiState, updateComposeDraft, toggleComposing, sendMessage } = useEmailStore()

  const [isExpanded, setIsExpanded] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Auto-focus and expand on mount
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      setIsExpanded(true)
    }
  }, [])

  const handleSend = () => {
    if (uiState.composeDraft.trim()) {
      sendMessage(threadId, uiState.composeDraft)
      setIsExpanded(false)
    }
  }

  const handleCancel = () => {
    updateComposeDraft('')
    toggleComposing()
    setIsExpanded(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Send on Ctrl/Cmd + Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }

    // Cancel on Escape
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-sm">
      {/* Compose Header */}
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-lg">✏️</span>
            <h4 className="font-medium text-gray-900">Reply to thread</h4>
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Cancel compose"
          >
            <span className="text-xl">×</span>
          </button>
        </div>
      </div>

      {/* Compose Body */}
      <div className="p-4">
        {/* Message Input */}
        <div className="mb-4">
          <textarea
            ref={textareaRef}
            value={uiState.composeDraft}
            onChange={(e) => updateComposeDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message here... (Ctrl+Enter to send, Esc to cancel)"
            className={`
              w-full border border-gray-300 rounded-md px-3 py-2 
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500 
              resize-none transition-all duration-200
              ${isExpanded ? 'h-32' : 'h-20'}
            `}
          />

          {/* Character count and draft info */}
          <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
            <div>{uiState.composeDraft.length > 0 && <span>{uiState.composeDraft.length} characters</span>}</div>
            <div>Draft auto-saved locally</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <span>💾</span>
            <span>Draft saved in local UI state</span>
          </div>

          <div className="flex items-center space-x-3">
            <button onClick={handleCancel} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!uiState.composeDraft.trim()}
              className={`
                px-4 py-2 rounded-md font-medium transition-colors
                ${
                  uiState.composeDraft.trim()
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              <span className="mr-1">📤</span>
              Send Message
            </button>
          </div>
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="mt-3 p-2 bg-gray-50 rounded text-xs text-gray-600">
          <strong>Keyboard shortcuts:</strong> Ctrl+Enter to send, Esc to cancel
        </div>
      </div>
    </div>
  )
}
