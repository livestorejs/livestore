import { createEffect, createSignal, onCleanup } from 'solid-js'

import { queryDb } from '@livestore/livestore'

import { events, tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'
import { playIncomingSound, playSentSound } from './sounds.ts'

// Define queries
const messagesQuery = queryDb(tables.messages.where({}), { label: 'messages' })
const reactionsQuery = queryDb(tables.reactions.where({}), { label: 'reactions' })
const usersQuery = queryDb(tables.users.where({}), { label: 'users' })
const readReceiptsQuery = queryDb(tables.readReceipts.where({}), { label: 'readReceipts' })

export const useChat = () => {
  const store = useAppStore()
  const [currentMessage, setCurrentMessage] = createSignal('')
  const [showReactionPicker, setShowReactionPicker] = createSignal<string | null>(null)
  const [uiState, setUiState] = store.useClientDocument(tables.uiState)

  // Use a variable for the ref (not reactive, just a container)
  let messagesEndRef: HTMLDivElement | undefined

  // Circuit breaker: track which messageIds we've already emitted a read receipt for
  const readCircuitBreaker = new Set<string>()
  // Circuit breaker: prevent re-emitting lastSeenMessageId across rebases
  const lastSeenCircuitBreaker = new Set<string>()

  // Get data from store
  const messages = store.useQuery(messagesQuery)
  const reactions = store.useQuery(reactionsQuery)
  const users = store.useQuery(usersQuery)
  const readReceipts = store.useQuery(readReceiptsQuery)

  const userContext = () => uiState()?.userContext

  // Sound and scroll effects
  createEffect(() => {
    const msgs = messages()
    if (!msgs) return

    const latestMessage = msgs[msgs.length - 1]
    if (!latestMessage) return

    const ctx = userContext()
    if (!ctx) return

    // Persist last seen for UI when it changes.
    // Guard with a session-local circuit breaker so rollbacks/rebases
    // don't cause repeated uiStateSet emissions.
    if (uiState()?.lastSeenMessageId !== latestMessage.id) {
      if (!lastSeenCircuitBreaker.has(latestMessage.id)) {
        lastSeenCircuitBreaker.add(latestMessage.id)
        setUiState({ lastSeenMessageId: latestMessage.id })
      }
    }

    // Only react to messages from others and guard with a session-local circuit breaker
    if (latestMessage.userId !== ctx.userId) {
      if (!readCircuitBreaker.has(latestMessage.id)) {
        readCircuitBreaker.add(latestMessage.id)
        playIncomingSound()
        store()?.commit(
          events.messageRead({
            id: `read-${latestMessage.id}-${ctx.userId}`,
            messageId: latestMessage.id,
            userId: ctx.userId,
            username: ctx.username,
            // Use the message timestamp for deterministic args across sessions.
            // This avoids cross-session divergence (args equality) during merge.
            timestamp: new Date(latestMessage.timestamp),
          }),
        )
      }
    }
  })

  // Initial scroll
  createEffect(() => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' })
  })

  // Actions
  const sendMessage = () => {
    const s = store()
    const ctx = userContext()
    const msg = currentMessage()
    if (!s || !msg.trim() || !ctx) return

    s.commit(
      events.messageCreated({
        id: crypto.randomUUID(),
        text: msg.trim(),
        userId: ctx.userId,
        username: ctx.username,
        timestamp: new Date(),
        isBot: false,
      }),
    )

    playSentSound()
    setCurrentMessage('')

    setTimeout(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
  }

  const addReaction = (messageId: string, emoji: string) => {
    const ctx = userContext()
    if (!ctx) return

    if (hasUserReacted(messageId, emoji, ctx.userId)) {
      return
    }

    store()?.commit(
      events.reactionAdded({
        id: crypto.randomUUID(),
        messageId,
        emoji,
        userId: ctx.userId,
        username: ctx.username,
      }),
    )
    setShowReactionPicker(null)
  }

  const removeReaction = (reactionId: string) => {
    store()?.commit(events.reactionRemoved({ id: reactionId }))
  }

  const toggleReactionPicker = (messageId: string) => {
    setShowReactionPicker(showReactionPicker() === messageId ? null : messageId)
  }

  // Helper functions
  const getReactionsForMessage = (messageId: string) => {
    return reactions()?.filter((r) => r.messageId === messageId) ?? []
  }

  const getReadReceiptsForMessage = (messageId: string) => {
    return readReceipts()?.filter((r) => r.messageId === messageId) ?? []
  }

  const hasUserReacted = (messageId: string, emoji: string, userId: string) => {
    return reactions()?.some((r) => r.messageId === messageId && r.emoji === emoji && r.userId === userId) ?? false
  }

  // Filter out current user from users list
  const otherUsers = () => {
    const ctx = userContext()
    return users()?.filter((user) => user.userId !== ctx?.userId) ?? []
  }

  return {
    // State
    currentMessage,
    setCurrentMessage,
    showReactionPicker,
    setShowReactionPicker,
    userContext,
    get messagesEndRef() {
      return messagesEndRef
    },
    set messagesEndRef(el: HTMLDivElement | undefined) {
      messagesEndRef = el
    },

    // Data
    messages,
    reactions,
    users,
    readReceipts,
    otherUsers,

    // Actions
    sendMessage,
    addReaction,
    removeReaction,
    toggleReactionPicker,

    // Helpers
    getReactionsForMessage,
    getReadReceiptsForMessage,
    hasUserReacted,
  }
}

export const useTheme = () => {
  // Always use dark mode as default - styles are set globally in index.css
  createEffect(() => {
    const body = document.body
    // Ensure any light mode classes are removed
    body.classList.remove('bg-gray-50', 'bg-white')
  })

  // Return dummy values for compatibility
  return { darkMode: true, toggleDarkMode: () => {} }
}

export const useReactionPickerClickOutside = (
  showReactionPicker: () => string | null,
  setShowReactionPicker: (value: string | null) => void,
) => {
  createEffect(() => {
    const picker = showReactionPicker()
    if (!picker) return

    const handleClickOutside = () => {
      setShowReactionPicker(null)
    }

    document.addEventListener('click', handleClickOutside)
    onCleanup(() => document.removeEventListener('click', handleClickOutside))
  })
}
