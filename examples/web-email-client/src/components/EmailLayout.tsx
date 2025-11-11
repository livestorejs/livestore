import { queryDb } from '@livestore/livestore'
import type React from 'react'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { LabelSidebar } from './LabelSidebar.tsx'
import { ThreadList } from './ThreadList.tsx'
import { ThreadView } from './ThreadView.tsx'

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })
const threadIndexQuery = queryDb(mailboxTables.threadIndex.where({}), { label: 'threadIndex' })

/**
 * Main email client layout
 *
 * Layout structure:
 * - Left sidebar with labels
 * - Main content area with thread view
 * - Gmail-inspired design patterns
 */
export const EmailLayout: React.FC = () => {
  const mailboxStore = useMailboxStore()
  const [uiState] = mailboxStore.useClientDocument(mailboxTables.uiState)
  const labels = mailboxStore.useQuery(labelsQuery)
  const threadIndex = mailboxStore.useQuery(threadIndexQuery)

  const selectedLabel = labels.find((l) => l.id === uiState.selectedLabelId)
  const selectedThreadId = uiState.selectedThreadId
  const currentThread = selectedThreadId && threadIndex.find((t) => t.id === selectedThreadId)

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">Email Client</h1>
          <p className="text-sm text-gray-500 mt-1">LiveStore</p>
        </div>
        <LabelSidebar />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">{selectedLabel?.name ?? 'Home'}</h2>
              <p className="text-sm text-gray-500">
                {currentThread
                  ? `Thread: ${currentThread.subject}`
                  : selectedLabel
                    ? `${selectedLabel.threadCount} threads`
                    : 'Select a label to view threads.'}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {selectedThreadId ? (
            <ThreadView threadId={selectedThreadId} />
          ) : selectedLabel ? (
            <ThreadList />
          ) : (
            <div className="flex flex-col text-center items-center justify-center h-full">
              <h3 className="text-lg font-medium text-gray-900 mb-2">LiveStore Email Client Example</h3>
              <p className="text-gray-500 max-w-md">
                This app demonstrates partial sync and cross-store sync in LiveStore. Select a label from the sidebar to
                view email threads.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
