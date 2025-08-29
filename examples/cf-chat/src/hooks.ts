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

    if (uiState.lastSeenMessageId !== latestMessage.id) {
      if (latestMessage.userId !== userContext.userId) {
        playIncomingSound()
      }

      setUiState({ lastSeenMessageId: latestMessage.id })

      if (latestMessage.userId !== userContext.userId) {
        store.commit(
          events.messageRead({
            id: `read-${latestMessage.id}-${userContext.userId}`,
            messageId: latestMessage.id,
            userId: userContext.userId,
            username: userContext.username,
            timestamp: new Date(),
          }),
        )
      }
    }
  }, [messages, userContext.userId, userContext.username, uiState.lastSeenMessageId, setUiState, store])

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
