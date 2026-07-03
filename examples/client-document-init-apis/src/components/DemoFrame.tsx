import type { Store } from '@livestore/livestore'
import { queryDb, Schema } from '@livestore/livestore'
import type { ReactApi } from '@livestore/react'
import React from 'react'

import type { EnsureClientDocumentResult } from '../ensure-client-document.ts'
import { schema, tables } from '../schema.ts'
import { ClientDocumentPanel } from './ClientDocumentPanel.tsx'
import { EventLogPanel } from './EventLogPanel.tsx'

export type DemoStore = Store<typeof schema> & ReactApi

export const firstThreadForMailbox$ = (mailboxId: string) =>
  queryDb(
    {
      query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt DESC LIMIT 1`,
      bindValues: [mailboxId],
      schema: Schema.Array(tables.threads.rowSchema),
    },
    { deps: mailboxId, label: `firstThread:${mailboxId}` },
  )

const threadsForMailbox$ = (mailboxId: string, direction: 'asc' | 'desc') =>
  queryDb(
    {
      query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt ${direction === 'desc' ? 'DESC' : 'ASC'}`,
      bindValues: [mailboxId],
      schema: Schema.Array(tables.threads.rowSchema),
    },
    { deps: `${mailboxId}:${direction}`, label: `threads:${mailboxId}:${direction}` },
  )

export const ThreadList = ({ store, documentId, mailboxId }: { store: DemoStore; documentId: string; mailboxId: string }) => {
  const [uiState, setUiState] = store.useClientDocument(tables.threadListUi, documentId)
  const threads = store.useQuery(threadsForMailbox$(mailboxId, uiState.sortDirection))

  return (
    <div className="card">
      <h2>Thread list</h2>
      <p>
        UI state: <span className="badge">{uiState.sortDirection}</span> selected:{' '}
        <span className="badge">{uiState.selectedThreadId ?? 'none'}</span>
      </p>
      <button type="button" onClick={() => setUiState({ sortDirection: 'asc' })}>
        Sort asc
      </button>
      <button type="button" onClick={() => setUiState({ sortDirection: 'desc' })}>
        Sort desc
      </button>
      <table className="thread-list">
        <thead>
          <tr>
            <th>Received</th>
            <th>Subject</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => (
            <tr key={thread.id}>
              <td>{thread.receivedAt}</td>
              <td>{thread.subject}</td>
              <td>
                <button type="button" onClick={() => setUiState({ selectedThreadId: thread.id })}>
                  Select
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const RenderCounter = ({ label }: { label: string }) => {
  const countRef = React.useRef(0)
  countRef.current += 1
  return <span className="badge">{label} renders: {countRef.current}</span>
}

export const DemoFrame = ({
  store,
  title,
  documentId,
  children,
  ensureResult,
}: {
  store: DemoStore
  title: string
  documentId: string
  children: React.ReactNode
  ensureResult?: EnsureClientDocumentResult | readonly EnsureClientDocumentResult[] | undefined
}) => (
  <div>
    <div className="card">
      <h1>{title}</h1>
      <RenderCounter label="route" />
      {ensureResult !== undefined ? <pre>{JSON.stringify(ensureResult, null, 2)}</pre> : null}
    </div>
    <div className="grid">
      <div>{children}</div>
      <aside>
        <ClientDocumentPanel store={store} documentId={documentId} />
        <EventLogPanel store={store} />
      </aside>
    </div>
  </div>
)
