import type { SyncState } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import React, { useState } from 'react'
import { useReactionPickerClickOutside } from './hooks.ts'

interface User {
  userId: string
  username: string
  timestamp: Date
  avatarEmoji?: string
  avatarColor?: string
}

interface Message {
  id: string
  text: string
  userId: string
  username: string
  timestamp: Date
  isBot: boolean
}

interface Reaction {
  id: string
  messageId: string
  emoji: string
  userId: string
  username: string
}

interface ReadReceipt {
  id: string
  messageId: string
  userId: string
  username: string
  timestamp: Date
}

interface UserSidebarProps {
  otherUsers: User[]
  userContext: { userId: string; username: string; avatarEmoji?: string; avatarColor?: string }
}

export const UserSidebar: React.FC<UserSidebarProps> = ({ otherUsers, userContext }) => (
  <div className="hidden md:flex md:w-64 lg:w-72 xl:w-80 bg-slate-800 border-r border-slate-700 p-4 flex-col overflow-y-auto transition-colors">
    <div className="text-sm font-medium text-slate-300 mb-3">Chats</div>
    <UserListItem
      testId="user-current-user"
      name={`${userContext.username} (You)`}
      emoji={userContext.avatarEmoji}
      color={userContext.avatarColor}
      active
    />
    {otherUsers.map((user) => (
      <UserListItem
        key={user.userId}
        testId={`user-${user.userId}`}
        name={user.username}
        emoji={user.avatarEmoji}
        color={user.avatarColor}
      />
    ))}
    <UserListItem testId="user-bot" name="ChatBot 🤖" emoji="🤖" color="#22c55e" />

    <div className="flex-1" />
    <SyncStates />
  </div>
)

const UserListItem = ({
  testId,
  name,
  emoji,
  color,
  active,
}: {
  testId: string
  name: string
  emoji?: string
  color?: string
  active?: boolean
}) => (
  <div
    data-testid={testId}
    className={`flex items-center gap-3 px-3 py-2 rounded-xl mb-2 ${active ? 'bg-blue-900/20' : 'hover:bg-gray-700'}`}
  >
    <AvatarCircle emoji={emoji} color={color} />
    <div className="flex-1 truncate text-gray-100 text-sm">{name}</div>
  </div>
)

const AvatarCircle = ({ emoji, color }: { emoji?: string; color?: string }) => (
  <div
    className="w-9 h-9 rounded-full flex items-center justify-center text-base"
    style={{ backgroundColor: color ?? '#e5e7eb' }}
  >
    <span>{emoji ?? '🙂'}</span>
  </div>
)

interface ChatHeaderProps {
  userContext: { username: string }
  otherUsers: User[]
  roomName: string
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ userContext, otherUsers, roomName }) => {
  return (
    <div className="mb-3 md:mb-4">
      <div className="relative flex items-center justify-center">
        <div className="absolute left-0 flex items-center gap-2">
          <div className="hidden md:block text-sm text-gray-400">{otherUsers.length + 2} users</div>
        </div>
        <div className="text-center">
          <h1 className="text-lg md:text-2xl font-semibold text-gray-100">💬 LiveChat</h1>
          <div className="text-xs md:text-sm text-gray-400">
            Room: {roomName} • {userContext.username}
          </div>
        </div>
      </div>
    </div>
  )
}

interface MessageInputProps {
  currentMessage: string
  setCurrentMessage: (message: string) => void
  sendMessage: () => void
}

export const MessageInput: React.FC<MessageInputProps> = ({ currentMessage, setCurrentMessage, sendMessage }) => (
  <div className="flex items-center gap-2 md:gap-3 lg:gap-4">
    <div className="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-full px-3 md:px-4 py-1.5 md:py-2 shadow-sm">
      <input
        data-testid="message-input"
        type="text"
        value={currentMessage}
        onChange={(e) => setCurrentMessage(e.target.value)}
        placeholder="iMessage..."
        className="flex-1 bg-transparent outline-none text-gray-100 placeholder-gray-500 text-base lg:text-lg"
        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
      />
    </div>
    <button
      type="button"
      data-testid="send-message"
      onClick={sendMessage}
      disabled={!currentMessage.trim()}
      className={`px-4 py-2 md:px-5 md:py-2.5 rounded-full font-medium transition-colors text-base lg:text-lg ${
        currentMessage.trim()
          ? 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer'
          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
      }`}
      title="Send"
    >
      Send
    </button>
  </div>
)

interface MessagesContainerProps {
  messages: readonly Message[]
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  userContext: { userId: string; username: string }
  getReactionsForMessage: (messageId: string) => readonly Reaction[]
  getReadReceiptsForMessage: (messageId: string) => readonly ReadReceipt[]
  removeReaction: (reactionId: string) => void
  showReactionPicker: string | null
  toggleReactionPicker: (messageId: string) => void
  addReaction: (messageId: string, emoji: string) => void
  setShowReactionPicker: (value: string | null) => void
}

const availableEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥']

export const MessagesContainer: React.FC<MessagesContainerProps> = ({
  messages,
  messagesEndRef,
  userContext,
  getReactionsForMessage,
  getReadReceiptsForMessage,
  removeReaction,
  showReactionPicker,
  toggleReactionPicker,
  addReaction,
  setShowReactionPicker,
}) => {
  useReactionPickerClickOutside(showReactionPicker, setShowReactionPicker)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const isAtBottom = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return true
    const threshold = 24
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Need to trigger on new messages only
  React.useEffect(() => {
    const shouldScroll = isAtBottom()
    if (shouldScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  const formatDateLabel = (d: Date) => {
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)
    if (isSameDay(d, today)) return 'Today'
    if (isSameDay(d, yesterday)) return 'Yesterday'
    return d.toLocaleDateString()
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6 mb-4 lg:mb-6 bg-gray-900 min-h-0 transition-colors"
    >
      {messages.map((message, index) => {
        const previous = index > 0 ? messages[index - 1] : undefined
        const next = index < messages.length - 1 ? messages[index + 1] : undefined
        const isOwn = message.userId === userContext.userId
        const sameAsPrev = previous !== undefined && previous.userId === message.userId
        const sameAsNext = next !== undefined && next.userId === message.userId
        const showHeader = !sameAsPrev
        const messageReactions = getReactionsForMessage(message.id)
        const messageReadReceipts = getReadReceiptsForMessage(message.id)

        const showDateSeparator = (() => {
          if (index === 0) return true
          if (previous === undefined) return true
          return !isSameDay(previous.timestamp, message.timestamp)
        })()

        const baseBubble = isOwn
          ? 'bg-blue-500 text-white'
          : message.isBot
            ? 'bg-blue-900/30 text-blue-100'
            : 'bg-gray-700 text-gray-100'

        const radius = (() => {
          // iMessage-like grouping radii
          if (isOwn) {
            if (sameAsPrev && sameAsNext) return 'rounded-2xl rounded-br-md'
            if (sameAsPrev && !sameAsNext) return 'rounded-2xl rounded-tr-md'
            if (!sameAsPrev && sameAsNext) return 'rounded-2xl rounded-bl-md'
            return 'rounded-2xl'
          }
          if (sameAsPrev && sameAsNext) return 'rounded-2xl rounded-bl-md'
          if (sameAsPrev && !sameAsNext) return 'rounded-2xl rounded-tl-md'
          if (!sameAsPrev && sameAsNext) return 'rounded-2xl rounded-br-md'
          return 'rounded-2xl'
        })()

        return (
          <div key={message.id}>
            {showDateSeparator && (
              <div className="my-3 md:my-4 flex items-center justify-center">
                <div className="px-3 py-1 text-xs rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                  {formatDateLabel(message.timestamp)}
                </div>
              </div>
            )}
            <div className={`mb-1 md:mb-2 ${isOwn ? 'flex justify-end' : 'flex justify-start'}`}>
              <div className="max-w-[80%] sm:max-w-[70%] md:max-w-[65%] mb-6">
                <div className="relative">
                  {/* Bubble */}
                  <div
                    data-testid={`message-${message.id}`}
                    className={`px-3 py-2 md:px-4 md:py-3 ${baseBubble} ${radius} shadow-sm`}
                  >
                    {showHeader && (
                      <div className={`mb-1 text-[11px] opacity-80 ${isOwn ? 'text-white/80' : 'text-gray-300'}`}>
                        <span className="font-medium">
                          {message.username}
                          {message.isBot && ' 🤖'}
                        </span>
                        <span className={`ml-2 ${isOwn ? 'text-white/70' : 'text-gray-400'}`}>
                          {message.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{message.text}</div>
                  </div>

                  {/* Reactions overlay */}
                  {messageReactions.length > 0 && (
                    <div
                      className={`absolute -top-6 ${'right-0.5'} flex gap-1 bg-slate-900 border border-slate-700 rounded-full px-1 py-0.5 shadow-sm`}
                    >
                      {messageReactions.map((reaction) => (
                        <button
                          type="button"
                          key={reaction.id}
                          data-testid={`reaction-${reaction.id}`}
                          onClick={() => {
                            if (reaction.userId === userContext.userId) {
                              removeReaction(reaction.id)
                            }
                          }}
                          className={`px-1.5 py-0.5 text-xs rounded-full ${
                            reaction.userId === userContext.userId
                              ? 'hover:bg-gray-700 cursor-pointer'
                              : 'cursor-default'
                          }`}
                          title={`${reaction.emoji} by ${reaction.username}${
                            reaction.userId === userContext.userId ? ' (click to remove)' : ''
                          }`}
                        >
                          {reaction.emoji}
                        </button>
                      ))}

                      {/* Add reaction button inline with reactions */}
                      <button
                        type="button"
                        data-testid={`add-reaction-${message.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleReactionPicker(message.id)
                        }}
                        className="px-1.5 py-0.5 text-xs rounded-full cursor-pointer text-slate-300 hover:bg-slate-800 transition-colors"
                        title="Add reaction"
                      >
                        ➕
                      </button>
                    </div>
                  )}

                  {/* Add reaction button and picker */}
                  <div className={`mt-1 ${isOwn ? 'text-right' : 'text-left'}`}>
                    {showReactionPicker === message.id && (
                      <div
                        data-testid={`reaction-picker-${message.id}`}
                        className={`absolute top-0 z-10 mt-1 ${
                          isOwn ? 'right-0' : 'left-0'
                        } bg-slate-900 border border-slate-700 rounded-lg p-2 flex gap-1 shadow-lg`}
                      >
                        {availableEmojis.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            data-testid={`emoji-${emoji}`}
                            onClick={() => addReaction(message.id, emoji)}
                            className="bg-transparent border-none p-1 rounded cursor-pointer text-base hover:bg-slate-800 transition-colors text-slate-100"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Read receipts for own messages (iMessage-like under bubble) */}
                  {isOwn && messageReadReceipts.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-slate-400 text-right">
                      Read by: {messageReadReceipts.map((r) => r.username).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div ref={messagesEndRef} />
    </div>
  )
}

const SyncStates = () => {
  const { store } = useStore()
  const [syncStates, setSyncStates] = useState<{ session: SyncState.SyncState; leader: SyncState.SyncState } | null>(
    null,
  )

  React.useEffect(() => {
    const interval = setInterval(() => {
      store._dev.syncStates().then(setSyncStates)
    }, 1000)
    return () => clearInterval(interval)
  }, [store])

  return (
    <div>
      <pre className="text-xs font-mono text-white bg-white/5 p-2 rounded-lg border border-transparent">
        {JSON.stringify(syncStates, null, 2)}
      </pre>
    </div>
  )
}
