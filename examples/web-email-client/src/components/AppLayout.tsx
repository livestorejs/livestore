import { queryDb } from '@livestore/livestore'
import type React from 'react'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useMailboxStore } from '../stores/mailbox/index.ts'
import { mailboxTables } from '../stores/mailbox/schema.ts'
import { LabelSidebar } from './LabelSidebar.tsx'
import { ThreadList } from './ThreadList.tsx'
import { ThreadView } from './ThreadView.tsx'

const labelsQuery = queryDb(mailboxTables.labels.where({}), { label: 'labels' })

export const AppLayout: React.FC = () => {
  const mailboxStore = useMailboxStore()

  const labels = mailboxStore.useQuery(labelsQuery)
  const [uiState] = mailboxStore.useClientDocument(mailboxTables.uiState)

  const selectedLabel = labels.find((l) => l.id === uiState.selectedLabelId)

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200">
        <LabelSidebar />
      </div>

      <div className="flex-1 flex flex-col">
        {/* Header */}
        {!uiState.selectedThreadId ? (
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-medium capitalize">{selectedLabel?.name.toLocaleLowerCase() ?? 'Home'}</h2>
          </div>
        ) : null}

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {uiState.selectedThreadId ? (
            <ErrorBoundary fallback={<ThreadError />}>
              <Suspense fallback={<ThreadLoading />}>
                <ThreadView threadId={uiState.selectedThreadId} />
              </Suspense>
            </ErrorBoundary>
          ) : selectedLabel ? (
            <ThreadList />
          ) : (
            <div className="grid place-items-center h-full">
              <div className="text-gray-500">
                <p>Select a label on the sidebar</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

const ThreadError: React.FC = () => (
  <div className="grid place-items-center h-full">
    <p className="text-gray-500">Failed to load thread</p>
  </div>
)

const ThreadLoading: React.FC = () => (
  <div className="grid place-items-center h-full">
    <p className="text-gray-500">Loading thread...</p>
  </div>
)
