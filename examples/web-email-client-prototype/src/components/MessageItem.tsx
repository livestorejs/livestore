import type React from 'react'

/**
 * MessageItem - Individual email message display
 *
 * Shows:
 * - Sender name and email
 * - Message timestamp
 * - Message content
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
    messageType: 'received' | 'sent' | 'draft'
  }
  isFirst: boolean
  isLast: boolean
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
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
        bg-gray-50 border border-gray-100
        hover:shadow-md hover:border-gray-300
      `}
    >
      {/* Message Header */}
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

      {/* Message Content */}
      <div className="ml-13">
        <div className="prose prose-sm max-w-none text-gray-700">
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>

        {/* Draft indicator */}
        {message.messageType === 'draft' && (
          <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700">
            <span className="font-medium">Draft:</span> This message hasn't been sent yet.
          </div>
        )}
      </div>
    </div>
  )
}
