import { queryDb } from '@livestore/livestore'
import { useClientDocument, useStore } from '@livestore/react'
import React from 'react'
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

  // Debug logging for initial data state (seeding now happens server-side)
  React.useEffect(() => {
    console.log('📊 Client-side data loaded:', {
      storeExists: !!store,
      threadsLength: threads.length,
      labelsLength: labels.length,
      threadLabelsLength: threadLabels.length,
      messagesLength: messages.length,
    })
  }, [store, threads.length, labels.length, threadLabels.length, messages.length])

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
      console.warn('Failed to send message:', error)
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
      console.warn('Failed to toggle message read status:', error)
    }
  }

  const applyLabelToThread = (threadId: string, labelId: string) => {
    if (!store) return

    try {
      // Check if label is already applied
      const existingAssociation = threadLabels.find((tl) => tl.threadId === threadId && tl.labelId === labelId)

      if (!existingAssociation) {
        store.commit(
          events.threadLabelApplied({
            threadId,
            labelId,
            appliedAt: new Date(),
          }),
        )
      }
    } catch (error) {
      console.warn('Failed to apply label to thread:', error)
    }
  }

  const removeLabelFromThread = (threadId: string, labelId: string) => {
    if (!store) return

    try {
      store.commit(
        events.threadLabelRemoved({
          threadId,
          labelId,
          removedAt: new Date(),
        }),
      )
    } catch (error) {
      console.warn('Failed to remove label from thread:', error)
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

  // Get system labels in order
  const systemLabels = labels.filter((l) => l.type === 'system').sort((a, b) => a.displayOrder - b.displayOrder)

  // Debug logging for data state
  React.useEffect(() => {
    console.log('📋 Current data state:', {
      allLabels: labels.map((l) => ({ id: l.id, name: l.name, type: l.type, displayOrder: l.displayOrder })),
      systemLabels: systemLabels.map((l) => ({ id: l.id, name: l.name, displayOrder: l.displayOrder })),
      threads: threads.map((t) => ({ id: t.id, subject: t.subject })),
      messages: messages.map((m) => ({ id: m.id, threadId: m.threadId, sender: m.sender })),
      threadLabels: threadLabels.map((tl) => ({ threadId: tl.threadId, labelId: tl.labelId })),
      counts: {
        labels: labels.length,
        systemLabels: systemLabels.length,
        threads: threads.length,
        messages: messages.length,
        threadLabels: threadLabels.length,
      },
    })
  }, [labels, systemLabels, threads, messages, threadLabels])

  return {
    // State
    uiState,

    // Data
    threads,
    messages,
    labels,
    threadLabels,
    systemLabels,

    // Actions
    sendMessage,
    toggleMessageRead,
    applyLabelToThread,
    removeLabelFromThread,

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
  }
}
