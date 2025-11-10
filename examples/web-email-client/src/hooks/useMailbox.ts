import { queryDb } from '@livestore/livestore'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'

/**
 * Mailbox Hook
 *
 * Provides label data and all UI state management:
 * - Label data and queries
 * - Thread index (projection of all threads for browsing/filtering)
 * - Thread-label associations (projection for filtering threads by label)
 * - Thread selection state
 * - Label selection state
 * - Compose UI state
 */

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadsQuery = queryDb(mailboxTables.threadIndex.where({}), { label: 'threadIndex' })
const threadLabelsQuery = queryDb(mailboxTables.threadLabels.where({}), { label: 'threadLabels' })

export const useMailbox = () => {
  const mailboxStore = useMailboxStore()
  const [uiState, setUiState] = mailboxStore.useClientDocument(mailboxTables.uiState)

  // Get labels data
  const labels = mailboxStore.useQuery(labelsQuery)

  // Get thread projections from Mailbox store (for efficient browsing/filtering)
  const threads = mailboxStore.useQuery(threadsQuery)
  const threadLabels = mailboxStore.useQuery(threadLabelsQuery)

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

  const currentLabel = labels.find((l) => l.id === uiState.selectedLabelId)
  const currentThreadId = uiState.selectedThreadId
  const currentThread = currentThreadId && threads.find((t) => t.id === currentThreadId)

  return {
    // Store
    mailboxStore,

    // State
    uiState,

    // Data
    labels,
    threadIndex: threads, // Projection of all threads for browsing
    threadLabels, // Projection of thread-label associations for filtering

    // UI Actions
    selectThread,
    selectLabel,
    updateComposeDraft,
    toggleComposing,

    // Helpers
    currentLabel,
    currentThreadId,
    currentThread,
  }
}
