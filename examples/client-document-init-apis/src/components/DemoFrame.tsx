import React from 'react'

import type { Store } from '@livestore/livestore'
import { queryDb, Schema } from '@livestore/livestore'
import type { ReactApi } from '@livestore/react'

import { schema, tables } from '../schema.ts'

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

export const ThreadList = ({
  store,
  documentId,
  mailboxId,
}: {
  store: DemoStore
  documentId: string
  mailboxId: string
}) => {
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

export const ClientOnlyDataSummary = ({
  documentId,
  mailboxId,
  pattern,
}: {
  documentId: string
  mailboxId: string
  pattern: string
}) => (
  <p>
    Example data: <span className="badge">{pattern}</span> document <span className="badge">{documentId}</span>{' '}
    mailbox <span className="badge">{mailboxId}</span>
  </p>
)

export const DemoFrame = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <header className="page-header">
      <h1>{title}</h1>
    </header>
    {children}
  </div>
)
