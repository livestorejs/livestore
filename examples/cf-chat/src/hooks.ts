import { queryDb } from '@livestore/livestore'
import { useClientDocument, useStore } from '@livestore/react'
import React, { useRef, useState } from 'react'
import { events, tables } from './livestore/schema.ts'
import { playIncomingSound, playSentSound } from './sounds.ts'

// Define queries
const messagesQuery = queryDb(tables.messages.where({}), { label: 'messages' })
const reactionsQuery = queryDb(tables.reactions.where({}), { label: 'reactions' })
const usersQuery = queryDb(tables.users.where({}), { label: 'users' })
const readReceiptsQuery = queryDb(tables.readReceipts.where({}), { label: 'readReceipts' })

export const useChat = () => {
  const { store } = useStore()
  const [currentMessage, setCurrentMessage] = useState('')
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null)
  const [uiState, setUiState] = useClientDocument(tables.uiState)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Circuit breaker: track which messageIds we've already emitted a read receipt for
  const readCircuitBreakerRef = useRef<Set<string>>(new Set())
  // Circuit breaker: prevent re-emitting lastSeenMessageId across rebases
  const lastSeenCircuitBreakerRef = useRef<Set<string>>(new Set())

  // Get data from store
  const messages = store.useQuery(messagesQuery)
  const reactions = store.useQuery(reactionsQuery)
  const users = store.useQuery(usersQuery)
  const readReceipts = store.useQuery(readReceiptsQuery)

  const userContext = uiState.userContext!

  // Sound and scroll effects
  React.useEffect(() => {
    const latestMessage = messages[messages.length - 1]
    if (!latestMessage) return

    // Persist last seen for UI when it changes.
    // Guard with a session-local circuit breaker so rollbacks/rebases
    // don't cause repeated uiStateSet emissions.
    if (uiState.lastSeenMessageId !== latestMessage.id) {
      if (!lastSeenCircuitBreakerRef.current.has(latestMessage.id)) {
        lastSeenCircuitBreakerRef.current.add(latestMessage.id)
        setUiState({ lastSeenMessageId: latestMessage.id })
      }
    }

    // Only react to messages from others and guard with a session-local circuit breaker
    if (latestMessage.userId !== userContext.userId) {
      if (!readCircuitBreakerRef.current.has(latestMessage.id)) {
        readCircuitBreakerRef.current.add(latestMessage.id)
        playIncomingSound()
        store.commit(
          events.messageRead({
            id: `read-${latestMessage.id}-${userContext.userId}`,
            messageId: latestMessage.id,
            userId: userContext.userId,
            username: userContext.username,
            // Use the message timestamp for deterministic args across sessions.
            // This avoids cross-session divergence (args equality) during merge.
            timestamp: new Date(latestMessage.timestamp),
          }),
        )
      }
    }
  }, [messages, userContext.userId, userContext.username, store, setUiState, uiState.lastSeenMessageId])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Actions
  const sendMessage = () => {
    if (!store || !currentMessage.trim()) return

    store.commit(
      events.messageCreated({
        id: crypto.randomUUID(),
        text: currentMessage.trim(),
        userId: userContext.userId,
        username: userContext.username,
        timestamp: new Date(),
        isBot: false,
      }),
    )

    playSentSound()
    setCurrentMessage('')

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
  }

  const addReaction = (messageId: string, emoji: string) => {
    if (hasUserReacted(messageId, emoji, userContext.userId)) {
      return
    }

    store.commit(
      events.reactionAdded({
        id: crypto.randomUUID(),
        messageId,
        emoji,
        userId: userContext.userId,
        username: userContext.username,
      }),
    )
    setShowReactionPicker(null)
  }

  const removeReaction = (reactionId: string) => {
    store.commit(events.reactionRemoved({ id: reactionId }))
  }

  const toggleReactionPicker = (messageId: string) => {
    setShowReactionPicker(showReactionPicker === messageId ? null : messageId)
  }

  // Helper functions
  const getReactionsForMessage = (messageId: string) => {
    return reactions.filter((r) => r.messageId === messageId)
  }

  const getReadReceiptsForMessage = (messageId: string) => {
    return readReceipts.filter((r) => r.messageId === messageId)
  }

  const hasUserReacted = (messageId: string, emoji: string, userId: string) => {
    return reactions.some((r) => r.messageId === messageId && r.emoji === emoji && r.userId === userId)
  }

  // Filter out current user from users list
  const otherUsers = users.filter((user) => user.userId !== userContext.userId)

  return {
    // State
    currentMessage,
    setCurrentMessage,
    showReactionPicker,
    setShowReactionPicker,
    userContext,
    messagesEndRef,

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
  React.useEffect(() => {
    const body = document.body
    // Ensure any light mode classes are removed
    body.classList.remove('bg-gray-50', 'bg-white')
  }, [])

  // Return dummy values for compatibility
  return { darkMode: true, toggleDarkMode: () => {} }
}

export const useReactionPickerClickOutside = (
  showReactionPicker: string | null,
  setShowReactionPicker: (value: string | null) => void,
) => {
  React.useEffect(() => {
    const handleClickOutside = () => {
      setShowReactionPicker(null)
    }

    if (showReactionPicker) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showReactionPicker, setShowReactionPicker])
}
