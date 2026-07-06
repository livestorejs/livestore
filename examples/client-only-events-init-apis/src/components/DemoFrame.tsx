import React from 'react'

import type { Store } from '@livestore/livestore'
import { queryDb, Schema } from '@livestore/livestore'
import type { useQuery } from '@livestore/react'

import { events, schema, tables, type SortDirection } from '../schema.ts'

export type DemoStore = Store<typeof schema> & { useQuery: typeof useQuery }

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

const threadListUi$ = (rowId: string) =>
  // Fail loudly if a pattern renders before its explicit ensure step; this read must never create the row.
  queryDb(tables.threadListUi.where({ id: rowId }).first({ behaviour: 'error' }), {
    deps: rowId,
    label: `threadListUi:${rowId}`,
  })

const receivedAtFormatter = new Intl.DateTimeFormat('en-US', {
  month: '2-digit',
  day: '2-digit',
  year: 'numeric',
})

const formatReceivedAt = (receivedAt: number) => {
  const timestampMs = receivedAt < 10_000_000_000 ? receivedAt * 1000 : receivedAt
  return receivedAtFormatter.format(new Date(timestampMs))
}

export const ThreadList = ({
  store,
  rowId,
  mailboxId,
}: {
  store: DemoStore
  rowId: string
  mailboxId: string
}) => {
  const uiState = store.useQuery(threadListUi$(rowId))
  const setSortDirection = React.useCallback(
    (sortDirection: SortDirection) => {
      store.commit(events.threadListSortDirectionChanged({ id: rowId, sortDirection }))
    },
    [rowId, store],
  )
  const selectThread = React.useCallback(
    (selectedThreadId: string) => {
      store.commit(events.threadListThreadSelected({ id: rowId, selectedThreadId }))
    },
    [rowId, store],
  )
  const threads = store.useQuery(threadsForMailbox$(mailboxId, uiState.sortDirection))

  return (
    <div className="card">
      <h2>Thread list</h2>
      <p>
        UI state: <span className="badge">{uiState.sortDirection}</span> selected:{' '}
        <span className="badge">{uiState.selectedThreadId ?? 'none'}</span>
      </p>
      <button type="button" onClick={() => setSortDirection('asc')}>
        Sort asc
      </button>
      <button type="button" onClick={() => setSortDirection('desc')}>
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
              <td>{formatReceivedAt(thread.receivedAt)}</td>
              <td>{thread.subject}</td>
              <td>
                <button type="button" onClick={() => selectThread(thread.id)}>
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
  rowId,
  mailboxId,
  pattern,
}: {
  rowId: string
  mailboxId: string
  pattern: string
}) => (
  <p>
    Example data: <span className="badge">{pattern}</span> row <span className="badge">{rowId}</span> mailbox{' '}
    <span className="badge">{mailboxId}</span>
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
