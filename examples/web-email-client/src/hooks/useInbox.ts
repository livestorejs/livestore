import { queryDb } from '@livestore/livestore'
import { useInboxStore } from '../stores/inbox/index.ts'
import { inboxTables } from '../stores/inbox/schema.ts'

/**
 * Inbox Hook
 *
 * Provides label data and all UI state management:
 * - Label data and queries
 * - Thread index (projection of all threads for browsing/filtering)
 * - Thread-label associations (projection for filtering threads by label)
 * - Thread selection state
 * - Label selection state
 * - Compose UI state
 */

const labelsQuery = queryDb(inboxTables.labels.where({}), { label: 'labels' })
const threadsQuery = queryDb(inboxTables.threadIndex.where({}), { label: 'threadIndex' })
const threadLabelsQuery = queryDb(inboxTables.threadLabels.where({}), { label: 'threadLabels' })

export const useInbox = () => {
  const inboxStore = useInboxStore()
  const [uiState, setUiState] = inboxStore.useClientDocument(inboxTables.uiState)

  // Get labels data
  const labels = inboxStore.useQuery(labelsQuery)

  // Get thread projections from Inbox aggregate (for efficient browsing/filtering)
  const threads = inboxStore.useQuery(threadsQuery)
  const threadLabels = inboxStore.useQuery(threadLabelsQuery)

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
    inboxStore,

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
