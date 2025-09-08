import type React from 'react'
import { useEmailStore } from '../hooks/useEmailStore.ts'

/**
 * MessageItem - Individual email message display
 *
 * Shows:
 * - Sender name and email
 * - Message timestamp
 * - Message content
 * - Read/unread status toggle
 * - Message type indicators
 */

interface MessageItemProps {
  message: {
    id: string
    threadId: string
    content: string
    sender: string
    senderName: string | null
    timestamp: Date
    isRead: boolean
    isDraft: boolean
    messageType: string
  }
  isFirst: boolean
  isLast: boolean
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, isFirst, isLast }) => {
  const { toggleMessageRead } = useEmailStore()

  const handleToggleRead = () => {
    toggleMessageRead(message.id, !message.isRead)
  }

  const getMessageTypeIcon = () => {
    switch (message.messageType) {
      case 'sent':
        return '📤'
      case 'received':
        return '📨'
      case 'draft':
        return '✏️'
      default:
        return '💬'
    }
  }

  const getMessageTypeColor = () => {
    switch (message.messageType) {
      case 'sent':
        return 'text-green-600'
      case 'received':
        return 'text-blue-600'
      case 'draft':
        return 'text-orange-600'
      default:
        return 'text-gray-600'
    }
  }

  return (
    <div
      className={`
        group relative p-4 rounded-lg transition-all duration-200
        ${message.isRead ? 'bg-gray-50 border border-gray-100' : 'bg-white border-2 border-blue-200 shadow-sm'}
        hover:shadow-md hover:border-gray-300
      `}
    >
      {/* Message Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start space-x-3">
          {/* Avatar/Icon */}
          <div className="flex-shrink-0">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
              {(message.senderName || message.sender).charAt(0).toUpperCase()}
            </div>
          </div>

          <div>
            {/* Sender Info */}
            <div className="flex items-center space-x-2">
              <h4 className="font-semibold text-gray-900">{message.senderName || message.sender}</h4>
              <span className={`text-sm font-medium ${getMessageTypeColor()}`}>
                {getMessageTypeIcon()} {message.messageType.toUpperCase()}
              </span>
            </div>

            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <span>{message.sender}</span>
              <span>•</span>
              <time>
                {message.timestamp.toLocaleDateString()} at{' '}
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleToggleRead}
            className={`
              text-xs px-2 py-1 rounded-full border transition-colors
              ${
                message.isRead
                  ? 'border-gray-300 text-gray-600 hover:bg-gray-100'
                  : 'border-blue-300 text-blue-600 hover:bg-blue-50'
              }
            `}
            title={message.isRead ? 'Mark as unread' : 'Mark as read'}
          >
            {message.isRead ? '✓ Read' : '○ Unread'}
          </button>
        </div>
      </div>

      {/* Message Content */}
      <div className="ml-13">
        <div
          className={`
            prose prose-sm max-w-none
            ${message.isRead ? 'text-gray-700' : 'text-gray-900'}
          `}
        >
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>

        {/* Draft indicator */}
        {message.isDraft && (
          <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700">
            <span className="font-medium">Draft:</span> This message hasn't been sent yet.
          </div>
        )}
      </div>

      {/* Read status indicator */}
      <div
        className={`
          absolute left-0 top-4 w-1 h-8 rounded-r transition-all duration-200
          ${message.isRead ? 'bg-transparent' : 'bg-blue-500'}
        `}
      />
    </div>
  )
}
