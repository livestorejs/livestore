import type React from 'react'

type MessageItemProps = {
  message: {
    content: string
    sender: string
    senderName: string | null
    timestamp: Date
  }
}

export const Message: React.FC<MessageItemProps> = ({ message }) => {
  return (
    <div className="p-4 rounded bg-white border border-gray-300">
      {/* Sender Info */}
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-semibold">{message.senderName || message.sender}</h4>
        <time className="text-sm text-gray-500">
          {message.timestamp.toLocaleDateString()}{' '}
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <div className="text-sm text-gray-500 mb-2">{message.sender}</div>

      {/* Message Content */}
      <div className="text-gray-700">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  )
}
