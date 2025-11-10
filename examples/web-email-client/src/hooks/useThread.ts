import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react/experimental'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { threadStoreOptions } from '../stores/thread/index.ts'
import { threadEvents, threadTables } from '../stores/thread/schema.ts'

/**
 * Thread Hook
 *
 * Provides thread-specific data and operations for a given threadId:
 * - Thread and message data
 * - Thread operations (send, trash, archive, etc.)
 * - Label management for threads
 *
 * Note: Queries threadLabels from Thread store (source of truth).
 * Labels aggregate maintains a synchronized projection for cross-thread filtering.
 * Use Labels aggregate's threadLabels for browsing/filtering, Thread's for detail view.
 */

const threadQuery = queryDb(threadTables.thread, { label: 'thread' })
const messagesQuery = queryDb(threadTables.messages.where({}), { label: 'messages' })
const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadLabelsQuery = queryDb(threadTables.threadLabels.where({}), { label: 'threadLabels' })

export const useThread = (threadId: string) => {
  const mailboxStore = useMailboxStore()
  const threadStore = useStore(threadStoreOptions(threadId))

  // Get data from stores
  const [thread] = threadStore.useQuery(threadQuery)
  const messages = threadStore.useQuery(messagesQuery)
  const labels = mailboxStore.useQuery(labelsQuery)

  // Query threadLabels from Thread store (source of truth for this thread's labels)
  const threadLabels = threadStore.useQuery(threadLabelsQuery)

  // Thread Actions
  const sendMessage = (threadId: string, content: string, sender = 'user@example.com') => {
    if (!threadStore || !content.trim()) return

    try {
      threadStore.commit(
        threadEvents.messageSent({
          id: crypto.randomUUID(),
          threadId,
          content: content.trim(),
          sender,
          senderName: 'Current User',
          timestamp: new Date(),
        }),
      )
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  const trashThread = (threadId: string) => {
    if (!threadStore) return

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
          threadEvents.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      // Add trash label (only if not already applied)
      if (!currentSystemLabel || currentSystemLabel.id !== trashLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelApplied({
            threadId,
            labelId: trashLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      // Atomic commit (only if there are events to commit)
      if (eventsToCommit.length > 0) {
        threadStore.commit(...eventsToCommit)
      }
    } catch (error) {
      console.error('Failed to trash thread:', error)
    }
  }

  const archiveThread = (threadId: string) => {
    if (!threadStore) return

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
          threadEvents.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      // Add archive label (only if not already applied)
      if (!currentSystemLabel || currentSystemLabel.id !== archiveLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelApplied({
            threadId,
            labelId: archiveLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      // Atomic commit (only if there are events to commit)
      if (eventsToCommit.length > 0) {
        threadStore.commit(...eventsToCommit)
      }
    } catch (error) {
      console.error('Failed to archive thread:', error)
    }
  }

  const moveToInbox = (threadId: string) => {
    if (!threadStore) return

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
          threadEvents.threadLabelRemoved({
            threadId,
            labelId: currentSystemLabel.id,
            removedAt: new Date(),
          }),
        )
      }

      // Add inbox label (only if not already applied)
      if (!currentSystemLabel || currentSystemLabel.id !== inboxLabel.id) {
        eventsToCommit.push(
          threadEvents.threadLabelApplied({
            threadId,
            labelId: inboxLabel.id,
            appliedAt: new Date(),
          }),
        )
      }

      // Atomic commit (only if there are events to commit)
      if (eventsToCommit.length > 0) {
        threadStore.commit(...eventsToCommit)
      }
    } catch (error) {
      console.error('Failed to move thread to inbox:', error)
    }
  }

  const applyUserLabelToThread = (threadId: string, labelId: string) => {
    if (!threadStore) return

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
      threadStore.commit(
        threadEvents.threadLabelApplied({
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
    if (!threadStore) return

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
      threadStore.commit(
        threadEvents.threadLabelRemoved({
          threadId,
          labelId: targetLabel.id,
          removedAt: new Date(),
        }),
      )
    } catch (error) {
      console.error(`Failed to remove user label ${targetLabel.name} from thread:`, error)
    }
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

  return {
    // Store
    threadStore,

    // Data
    thread,
    messages,
    threadLabels,

    // Actions
    sendMessage,
    trashThread,
    archiveThread,
    moveToInbox,
    applyUserLabelToThread,
    removeUserLabelFromThread,

    // Helpers
    getMessagesForThread,
    getLabelsForThread,
    getUserLabelsForThread,
  }
}

// Export queries for reuse
export { threadQuery }
