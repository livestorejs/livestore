import { queryDb } from '@livestore/livestore'
import { useClientDocument, useStore } from '@livestore/react'
import { events, tables } from '../livestore/schema.ts'

/**
 * Email Store Hook
 *
 * Provides hooks and actions for email client functionality:
 * - Thread and message management
 * - Label operations
 * - Cross-aggregate actions
 * - UI state management
 */

// Define queries for email data
const threadsQuery = queryDb(tables.threads.where({}), { label: 'threads' })
const messagesQuery = queryDb(tables.messages.where({}), { label: 'messages' })
const labelsQuery = queryDb(tables.labels.where({}), { label: 'labels' })
const threadLabelsQuery = queryDb(tables.threadLabels.where({}), { label: 'threadLabels' })

export const useEmailStore = () => {
  const { store } = useStore()
  const [uiState, setUiState] = useClientDocument(tables.uiState)

  // Get data from store
  const threads = store.useQuery(threadsQuery)
  const messages = store.useQuery(messagesQuery)
  const labels = store.useQuery(labelsQuery)
  const threadLabels = store.useQuery(threadLabelsQuery)

  // Email Actions
  const sendMessage = (threadId: string, content: string, sender = 'user@example.com') => {
    if (!store || !content.trim()) return

    try {
      store.commit(
        events.messageSent({
          id: crypto.randomUUID(),
          threadId,
          content: content.trim(),
          sender,
          senderName: 'Current User',
          timestamp: new Date(),
        }),
      )

      // Clear compose draft
      setUiState({ composeDraft: '', isComposing: false })
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const toggleMessageRead = (messageId: string, isRead: boolean) => {
    if (!store) return

    try {
      store.commit(
        events.messageRead({
          messageId,
          isRead,
          timestamp: new Date(),
        }),
      )
    } catch (error) {
      console.error('Failed to toggle message read status:', error)
    }
  }

  const trashThread = (threadId: string) => {
    if (!store) return

    const trashLabel = labels.find((l) => l.name === 'TRASH')
    if (!trashLabel) {
      console.error('Trash label not found')
      return
    }

    try {
      store.commit(
        events.threadLabelApplied({
          threadId,
          labelId: trashLabel.id,
          appliedAt: new Date(),
        }),
      )
    } catch (error) {
      console.error('Failed to trash thread:', error)
    }
  }

  const archiveThread = (threadId: string) => {
    if (!store) return

    const archiveLabel = labels.find((l) => l.name === 'ARCHIVE')
    if (!archiveLabel) {
      console.error('Archive label not found')
      return
    }

    try {
      store.commit(
        events.threadLabelApplied({
          threadId,
          labelId: archiveLabel.id,
          appliedAt: new Date(),
        }),
      )
    } catch (error) {
      console.error('Failed to archive thread:', error)
    }
  }

  // UI Actions
  const selectThread = (threadId: string | null) => {
    setUiState({ selectedThreadId: threadId })
  }

  const selectLabel = (labelId: string) => {
    setUiState({ selectedLabelId: labelId, selectedThreadId: null })
  }

  const updateComposeDraft = (content: string) => {
    setUiState({ composeDraft: content })
  }

  const toggleComposing = () => {
    setUiState({ isComposing: !uiState.isComposing })
  }

  // Helper functions
  const getMessagesForThread = (threadId: string) => {
    return messages.filter((m) => m.threadId === threadId).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  const getLabelsForThread = (threadId: string) => {
    const labelIds = threadLabels.filter((tl) => tl.threadId === threadId).map((tl) => tl.labelId)

    return labels.filter((l) => labelIds.includes(l.id))
  }

  const getThreadsForLabel = (labelId: string) => {
    const threadIds = threadLabels.filter((tl) => tl.labelId === labelId).map((tl) => tl.threadId)

    return threads.filter((t) => threadIds.includes(t.id))
  }

  const getCurrentThread = () => {
    if (!uiState.selectedThreadId) return null
    return threads.find((t) => t.id === uiState.selectedThreadId) || null
  }

  const getCurrentLabel = () => {
    return labels.find((l) => l.id === uiState.selectedLabelId) || null
  }

  // Compute thread message count dynamically
  const getThreadMessageCount = (threadId: string) => {
    return messages.filter((m) => m.threadId === threadId).length
  }

  // Compute thread unread count dynamically
  const getThreadUnreadCount = (threadId: string) => {
    return messages.filter((m) => m.threadId === threadId && !m.isRead).length
  }

  return {
    // State
    uiState,

    // Data
    threads,
    messages,
    labels,
    threadLabels,

    // Actions
    sendMessage,
    toggleMessageRead,
    trashThread,
    archiveThread,

    // UI Actions
    selectThread,
    selectLabel,
    updateComposeDraft,
    toggleComposing,

    // Helpers
    getMessagesForThread,
    getLabelsForThread,
    getThreadsForLabel,
    getCurrentThread,
    getCurrentLabel,
    getThreadMessageCount,
    getThreadUnreadCount,
  }
}
