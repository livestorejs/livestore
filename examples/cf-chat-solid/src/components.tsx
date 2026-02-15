import type { SyncState } from '@livestore/livestore'
import { type Accessor, createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { useReactionPickerClickOutside } from './hooks.ts'
import { useAppStore } from './livestore/store.ts'

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
  otherUsers: Accessor<User[]>
  userContext: Accessor<{ userId: string; username: string; avatarEmoji?: string; avatarColor?: string } | undefined>
}

export const UserSidebar = (props: UserSidebarProps) => (
  <div class="hidden md:flex md:w-64 lg:w-72 xl:w-80 bg-slate-800 border-r border-slate-700 p-4 flex-col overflow-y-auto transition-colors">
    <div class="text-sm font-medium text-slate-300 mb-3">Chats</div>
    <Show when={props.userContext()}>
      {(ctx) => (
        <UserListItem
          testId="user-current-user"
          name={`${ctx().username} (You)`}
          emoji={ctx().avatarEmoji}
          color={ctx().avatarColor}
          active
        />
      )}
    </Show>
    <For each={props.otherUsers()}>
      {(user) => (
        <UserListItem
          testId={`user-${user.userId}`}
          name={user.username}
          emoji={user.avatarEmoji}
          color={user.avatarColor}
        />
      )}
    </For>
    <UserListItem testId="user-bot" name="ChatBot 🤖" emoji="🤖" color="#22c55e" />

    <div class="flex-1" />
    <SyncStates />
  </div>
)

const UserListItem = (props: { testId: string; name: string; emoji?: string; color?: string; active?: boolean }) => (
  <div
    data-testid={props.testId}
    class={`flex items-center gap-3 px-3 py-2 rounded-xl mb-2 ${props.active ? 'bg-blue-900/20' : 'hover:bg-gray-700'}`}
  >
    <AvatarCircle emoji={props.emoji} color={props.color} />
    <div class="flex-1 truncate text-gray-100 text-sm">{props.name}</div>
  </div>
)

const avatarCircleStyleCache = new Map<string, { 'background-color': string }>()

const getAvatarCircleStyle = (color?: string) => {
  const backgroundColor = color ?? '#e5e7eb'
  const cachedStyle = avatarCircleStyleCache.get(backgroundColor)
  if (cachedStyle !== undefined) {
    return cachedStyle
  }
  const style = { 'background-color': backgroundColor }
  avatarCircleStyleCache.set(backgroundColor, style)
  return style
}

const AvatarCircle = (props: { emoji?: string; color?: string }) => (
  <div
    class="w-9 h-9 rounded-full flex items-center justify-center text-base"
    style={getAvatarCircleStyle(props.color)}
  >
    <span>{props.emoji ?? '🙂'}</span>
  </div>
)

interface ChatHeaderProps {
  userContext: Accessor<{ username: string } | undefined>
  otherUsers: Accessor<User[]>
  roomName: string
}

export const ChatHeader = (props: ChatHeaderProps) => {
  return (
    <div class="mb-3 md:mb-4">
      <div class="relative flex items-center justify-center">
        <div class="absolute left-0 flex items-center gap-2">
          <div class="hidden md:block text-sm text-gray-400">{props.otherUsers().length + 2} users</div>
        </div>
        <div class="text-center">
          <h1 class="text-lg md:text-2xl font-semibold text-gray-100">💬 LiveChat</h1>
          <div class="text-xs md:text-sm text-gray-400">
            Room: {props.roomName} • {props.userContext()?.username}
          </div>
        </div>
      </div>
    </div>
  )
}

interface MessageInputProps {
  currentMessage: Accessor<string>
  setCurrentMessage: (message: string) => void
  sendMessage: () => void
}

export const MessageInput = (props: MessageInputProps) => {
  const handleInput = createMemo(
    () => (e: InputEvent & { currentTarget: HTMLInputElement }) => props.setCurrentMessage(e.currentTarget.value),
  )
  const handleKeyDown = createMemo(
    () => (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => e.key === 'Enter' && props.sendMessage(),
  )

  return (
    <div class="flex items-center gap-2 md:gap-3 lg:gap-4">
      <div class="flex-1 flex items-center bg-gray-800 border border-gray-700 rounded-full px-3 md:px-4 py-1.5 md:py-2 shadow-sm">
        <input
          data-testid="message-input"
          type="text"
          value={props.currentMessage()}
          onInput={handleInput()}
          placeholder="iMessage..."
          class="flex-1 bg-transparent outline-none text-gray-100 placeholder-gray-500 text-base lg:text-lg"
          onKeyDown={handleKeyDown()}
        />
      </div>
      <button
        type="button"
        data-testid="send-message"
        onClick={props.sendMessage}
        disabled={!props.currentMessage().trim()}
        class={`px-4 py-2 md:px-5 md:py-2.5 rounded-full font-medium transition-colors text-base lg:text-lg ${
          props.currentMessage().trim()
            ? 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
        }`}
        title="Send"
      >
        Send
      </button>
    </div>
  )
}

interface MessagesContainerProps {
  messages: Accessor<readonly Message[] | undefined>
  messagesEndRef: (el: HTMLDivElement) => void
  userContext: Accessor<{ userId: string; username: string } | undefined>
  getReactionsForMessage: (messageId: string) => readonly Reaction[]
  getReadReceiptsForMessage: (messageId: string) => readonly ReadReceipt[]
  removeReaction: (reactionId: string) => void
  showReactionPicker: Accessor<string | null>
  toggleReactionPicker: (messageId: string) => void
  addReaction: (messageId: string, emoji: string) => void
  setShowReactionPicker: (value: string | null) => void
}

const availableEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥']

export const MessagesContainer = (props: MessagesContainerProps) => {
  useReactionPickerClickOutside(props.showReactionPicker, props.setShowReactionPicker)
  let containerRef: HTMLDivElement | undefined

  const isAtBottom = () => {
    const el = containerRef
    if (!el) return true
    const threshold = 24
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold
  }

  let messagesEndEl: HTMLDivElement | undefined

  const handleRemoveReaction = createMemo(() => (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const reactionId = e.currentTarget.dataset.reactionId
    const reactionUserId = e.currentTarget.dataset.reactionUserId
    if (reactionId && reactionUserId === props.userContext()?.userId) {
      props.removeReaction(reactionId)
    }
  })

  const handleToggleReactionPicker = createMemo(() => (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    e.stopPropagation()
    const messageId = e.currentTarget.dataset.messageId
    if (messageId) {
      props.toggleReactionPicker(messageId)
    }
  })

  const handleAddReaction = createMemo(() => (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const messageId = e.currentTarget.dataset.messageId
    const emoji = e.currentTarget.dataset.emoji
    if (messageId && emoji) {
      props.addReaction(messageId, emoji)
    }
  })

  createEffect(() => {
    if (messagesEndEl) {
      props.messagesEndRef(messagesEndEl)
    }
  })

  // Scroll on new messages
  createEffect(() => {
    const msgs = props.messages()
    if (!msgs) return

    // Track length changes
    const _len = msgs.length
    const shouldScroll = isAtBottom()
    if (shouldScroll) {
      messagesEndEl?.scrollIntoView({ behavior: 'smooth' })
    }
  })

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
      class="relative flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6 mb-4 lg:mb-6 bg-gray-900 min-h-0 transition-colors"
    >
      <For each={props.messages()}>
        {(message, index) => {
          const msgs = props.messages()!
          const previous = index() > 0 ? msgs[index() - 1] : undefined
          const next = index() < msgs.length - 1 ? msgs[index() + 1] : undefined
          const isOwn = message.userId === props.userContext()?.userId
          const sameAsPrev = previous !== undefined && previous.userId === message.userId
          const sameAsNext = next !== undefined && next.userId === message.userId
          const showHeader = !sameAsPrev
          const messageReactions = () => props.getReactionsForMessage(message.id)
          const messageReadReceipts = () => props.getReadReceiptsForMessage(message.id)

          const showDateSeparator = (() => {
            if (index() === 0) return true
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
            <div>
              <Show when={showDateSeparator}>
                <div class="my-3 md:my-4 flex items-center justify-center">
                  <div class="px-3 py-1 text-xs rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                    {formatDateLabel(message.timestamp)}
                  </div>
                </div>
              </Show>
              <div class={`mb-1 md:mb-2 ${isOwn ? 'flex justify-end' : 'flex justify-start'}`}>
                <div class="max-w-[80%] sm:max-w-[70%] md:max-w-[65%] mb-6">
                  <div class="relative">
                    {/* Bubble */}
                    <div
                      data-testid={`message-${message.id}`}
                      class={`px-3 py-2 md:px-4 md:py-3 ${baseBubble} ${radius} shadow-sm`}
                    >
                      <Show when={showHeader}>
                        <div class={`mb-1 text-[11px] opacity-80 ${isOwn ? 'text-white/80' : 'text-gray-300'}`}>
                          <span class="font-medium">
                            {message.username}
                            {message.isBot && ' 🤖'}
                          </span>
                          <span class={`ml-2 ${isOwn ? 'text-white/70' : 'text-gray-400'}`}>
                            {message.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                      </Show>
                      <div class="whitespace-pre-wrap break-words">{message.text}</div>
                    </div>

                    {/* Reactions overlay */}
                    <Show when={messageReactions().length > 0}>
                      <div class="absolute -top-6 right-0.5 flex gap-1 bg-slate-900 border border-slate-700 rounded-full px-1 py-0.5 shadow-sm">
                        <For each={messageReactions()}>
                          {(reaction) => (
                            <button
                              type="button"
                              data-testid={`reaction-${reaction.id}`}
                              data-reaction-id={reaction.id}
                              data-reaction-user-id={reaction.userId}
                              onClick={handleRemoveReaction()}
                              class={`px-1.5 py-0.5 text-xs rounded-full ${
                                reaction.userId === props.userContext()?.userId
                                  ? 'hover:bg-gray-700 cursor-pointer'
                                  : 'cursor-default'
                              }`}
                              title={`${reaction.emoji} by ${reaction.username}${
                                reaction.userId === props.userContext()?.userId ? ' (click to remove)' : ''
                              }`}
                            >
                              {reaction.emoji}
                            </button>
                          )}
                        </For>

                        {/* Add reaction button inline with reactions */}
                        <button
                          type="button"
                          data-testid={`add-reaction-${message.id}`}
                          data-message-id={message.id}
                          onClick={handleToggleReactionPicker()}
                          class="px-1.5 py-0.5 text-xs rounded-full cursor-pointer text-slate-300 hover:bg-slate-800 transition-colors"
                          title="Add reaction"
                        >
                          ➕
                        </button>
                      </div>
                    </Show>

                    {/* Add reaction button and picker */}
                    <div class={`mt-1 ${isOwn ? 'text-right' : 'text-left'}`}>
                      <Show when={props.showReactionPicker() === message.id}>
                        <div
                          data-testid={`reaction-picker-${message.id}`}
                          class={`absolute top-0 z-10 mt-1 ${
                            isOwn ? 'right-0' : 'left-0'
                          } bg-slate-900 border border-slate-700 rounded-lg p-2 flex gap-1 shadow-lg`}
                        >
                          <For each={availableEmojis}>
                            {(emoji) => (
                              <button
                                type="button"
                                data-testid={`emoji-${emoji}`}
                                data-message-id={message.id}
                                data-emoji={emoji}
                                onClick={handleAddReaction()}
                                class="bg-transparent border-none p-1 rounded cursor-pointer text-base hover:bg-slate-800 transition-colors text-slate-100"
                              >
                                {emoji}
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>

                    {/* Read receipts for own messages (iMessage-like under bubble) */}
                    <Show when={isOwn && messageReadReceipts().length > 0}>
                      <div class="mt-0.5 text-[11px] text-slate-400 text-right">
                        Read by:{' '}
                        {messageReadReceipts()
                          .map((r) => r.username)
                          .join(', ')}
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          )
        }}
      </For>
      <div ref={messagesEndEl} />
    </div>
  )
}

const SyncStates = () => {
  const store = useAppStore()
  const [syncStates, setSyncStates] = createSignal<{
    session: SyncState.SyncState
    leader: SyncState.SyncState
  } | null>(null)

  createEffect(() => {
    const s = store()
    if (!s) return

    const interval = setInterval(() => {
      s._dev.syncStates().then(setSyncStates)
    }, 1000)

    onCleanup(() => clearInterval(interval))
  })

  return (
    <div>
      <pre class="text-xs font-mono text-white bg-white/5 p-2 rounded-lg border border-transparent">
        {JSON.stringify(syncStates(), null, 2)}
      </pre>
    </div>
  )
}
