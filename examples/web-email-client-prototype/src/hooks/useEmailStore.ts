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

    // Get current system label
    const currentSystemLabel = getSystemLabelForThread(threadId)

    try {
      const eventsToCommit = []

      // Remove current system label if exists and it's not already TRASH
      if (currentSystemLabel && currentSystemLabel.id !== trashLabel.id) {
        eventsToCommit.push(
          events.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      // Add trash label (only if not already applied)
      if (!currentSystemLabel || currentSystemLabel.id !== trashLabel.id) {
        eventsToCommit.push(
          events.threadLabelApplied({
            threadId,
            labelId: trashLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      // Atomic commit (only if there are events to commit)
      if (eventsToCommit.length > 0) {
        store.commit(...eventsToCommit)
      }
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

    // Get current system label
    const currentSystemLabel = getSystemLabelForThread(threadId)

    try {
      const eventsToCommit = []

      // Remove current system label if exists and it's not already ARCHIVE
      if (currentSystemLabel && currentSystemLabel.id !== archiveLabel.id) {
        eventsToCommit.push(
          events.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      // Add archive label (only if not already applied)
      if (!currentSystemLabel || currentSystemLabel.id !== archiveLabel.id) {
        eventsToCommit.push(
          events.threadLabelApplied({
            threadId,
            labelId: archiveLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      // Atomic commit (only if there are events to commit)
      if (eventsToCommit.length > 0) {
        store.commit(...eventsToCommit)
      }
    } catch (error) {
      console.error('Failed to archive thread:', error)
    }
  }

  const moveToInbox = (threadId: string) => {
    if (!store) return

    const inboxLabel = labels.find((l) => l.name === 'INBOX')
    if (!inboxLabel) {
      console.error('Inbox label not found')
      return
    }

    // Get current system label
    const currentSystemLabel = getSystemLabelForThread(threadId)

    try {
      const eventsToCommit = []

      // Remove current system label if exists and it's not already INBOX
      if (currentSystemLabel && currentSystemLabel.id !== inboxLabel.id) {
        eventsToCommit.push(
          events.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      // Add inbox label (only if not already applied)
      if (!currentSystemLabel || currentSystemLabel.id !== inboxLabel.id) {
        eventsToCommit.push(
          events.threadLabelApplied({
            threadId,
            labelId: inboxLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      // Atomic commit (only if there are events to commit)
      if (eventsToCommit.length > 0) {
        store.commit(...eventsToCommit)
      }
    } catch (error) {
      console.error('Failed to move thread to inbox:', error)
    }
  }

  const applyUserLabelToThread = (threadId: string, labelId: string) => {
    if (!store) return

    const targetLabel = labels.find((l) => l.id === labelId)
    if (!targetLabel) {
      console.error('Target label not found')
      return
    }

    if (targetLabel.type !== 'user') {
      console.error('Can only apply user labels with this function')
      return
    }

    // Check if label is already applied
    const isLabelApplied = getLabelsForThread(threadId).some((l) => l.id === labelId)
    if (isLabelApplied) {
      return // Already applied, nothing to do
    }

    try {
      store.commit(
        events.threadLabelApplied({
          threadId,
          labelId: targetLabel.id,
          appliedAt: new Date(),
        }),
      )
    } catch (error) {
      console.error(`Failed to apply user label ${targetLabel.name} to thread:`, error)
    }
  }

  const removeUserLabelFromThread = (threadId: string, labelId: string) => {
    if (!store) return

    const targetLabel = labels.find((l) => l.id === labelId)
    if (!targetLabel) {
      console.error('Target label not found')
      return
    }

    if (targetLabel.type !== 'user') {
      console.error('Can only remove user labels with this function')
      return
    }

    // Check if label is actually applied
    const isLabelApplied = getLabelsForThread(threadId).some((l) => l.id === labelId)
    if (!isLabelApplied) {
      return // Not applied, nothing to do
    }

    try {
      store.commit(
        events.threadLabelRemoved({
          threadId,
          labelId: targetLabel.id,
          removedAt: new Date(),
        }),
      )
    } catch (error) {
      console.error(`Failed to remove user label ${targetLabel.name} from thread:`, error)
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

  const getUserLabelsForThread = (threadId: string) => {
    const allLabels = getLabelsForThread(threadId)
    return allLabels.filter((l) => l.type === 'user')
  }

  // Get current system label for a thread (should be only one)
  const getSystemLabelForThread = (threadId: string) => {
    const threadLabels = getLabelsForThread(threadId)
    const systemLabels = threadLabels.filter((l) => l.type === 'system')
    return systemLabels[0] || null // Return first system label found
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
    moveToInbox,
    applyUserLabelToThread,
    removeUserLabelFromThread,

    // UI Actions
    selectThread,
    selectLabel,
    updateComposeDraft,
    toggleComposing,

    // Helpers
    getMessagesForThread,
    getLabelsForThread,
    getUserLabelsForThread,
    getThreadsForLabel,
    getCurrentThread,
    getCurrentLabel,
    getThreadMessageCount,
    getThreadUnreadCount,
  }
}
