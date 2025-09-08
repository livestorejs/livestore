import { queryDb } from '@livestore/livestore'
import { useClientDocument, useStore } from '@livestore/react'
import React from 'react'
import { events, tables } from '../livestore/schema.ts'
import { seedEmailClientData } from '../livestore/seed.ts'

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

  // Seed data on first load if no data exists
  React.useEffect(() => {
    if (store && threads.length === 0 && labels.length === 0) {
      console.log('🌱 Seeding email client data...')
      seedEmailClientData(store)
    }
  }, [store, threads.length, labels.length])

  // Email Actions
  const sendMessage = (threadId: string, content: string, sender = 'user@example.com') => {
    if (!store || !content.trim()) return

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
  }

  const toggleMessageRead = (messageId: string, isRead: boolean) => {
    if (!store) return

    store.commit(
      events.messageRead({
        messageId,
        isRead,
        timestamp: new Date(),
      }),
    )
  }

  const applyLabelToThread = (threadId: string, labelId: string) => {
    if (!store) return

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
  }

  const removeLabelFromThread = (threadId: string, labelId: string) => {
    if (!store) return

    store.commit(
      events.threadLabelRemoved({
        threadId,
        labelId,
        removedAt: new Date(),
      }),
    )
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
  const systemLabels = labels.filter((l) => l.type === 'system').sort((a, b) => a.order - b.order)

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
