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
const threadIndexQuery = queryDb(mailboxTables.threadIndex.where({}), { label: 'threadIndex' })
const threadLabelsQuery = queryDb(mailboxTables.threadLabels.where({}), { label: 'threadLabels' })

export const useMailbox = () => {
  const mailboxStore = useMailboxStore()
  const [uiState, setUiState] = mailboxStore.useClientDocument(mailboxTables.uiState)

  // Get labels data
  const labels = mailboxStore.useQuery(labelsQuery)

  // Get thread projections from Mailbox store (for efficient browsing/filtering)
  const threadIndex = mailboxStore.useQuery(threadIndexQuery)
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

  // TODO: use queries
  const selectedLabel = labels.find((l) => l.id === uiState.selectedLabelId)
  const threadsForSelectedLabel = selectedLabel
    ? threadLabels
        .filter((tl) => tl.labelId === selectedLabel.id)
        .map((tl) => threadIndex.find((t) => t.id === tl.threadId))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
    : undefined
  const selectedThreadId = uiState.selectedThreadId
  const currentThread = selectedThreadId && threadIndex.find((t) => t.id === selectedThreadId)

  return {
    // Store
    mailboxStore,

    // State
    uiState,

    // Data
    labels,
    threadIndex, // Projection of all threads for browsing
    threadLabels, // Projection of thread-label associations for filtering
    selectedThreadId,
    selectedLabelId: uiState.selectedLabelId,

    // UI Actions
    selectThread,
    selectLabel,
    updateComposeDraft,
    toggleComposing,

    // Helpers
    selectedLabel,
    threadsForSelectedLabel,
    currentThread,
  }
}
