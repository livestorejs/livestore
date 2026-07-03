import React from 'react'

import type { Store } from '@livestore/livestore'
import { queryDb, Schema } from '@livestore/livestore'
import type { ReactApi } from '@livestore/react'

import { endNavigationTrace, startTraceSpan, withTraceSpan } from '../otel.ts'
import { schema, tables } from '../schema.ts'

export type DemoStore = Store<typeof schema> & ReactApi

export const ExampleSuspenseBoundary = ({
  children,
  name = 'example',
}: {
  readonly children: React.ReactNode
  readonly name?: string
}) => (
  <React.Suspense fallback={<SuspenseFallbackSpan name={name} />}>
    {children}
  </React.Suspense>
)

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

  React.useEffect(() => {
    withTraceSpan(
      'react.thread_list.ready',
      {
        'client_document.id': documentId,
        'mailbox.id': mailboxId,
        'thread_list.thread_count': threads.length,
        'thread_list.sort_direction': uiState.sortDirection,
        'thread_list.selected_thread_id': uiState.selectedThreadId ?? '<none>',
      },
      () => undefined,
    )
  }, [documentId, mailboxId, threads.length, uiState.selectedThreadId, uiState.sortDirection])

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

export const DemoFrame = ({ title, children }: { title: string; children: React.ReactNode }) => {
  React.useEffect(() => {
    endNavigationTrace({ 'route.title': title })
    const span = startTraceSpan('react.page.mounted', { 'route.title': title })
    return () => span.end()
  }, [title])

  return (
    <div>
      <header className="page-header">
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  )
}

function SuspenseFallbackSpan({ name }: { readonly name: string }) {
  React.useEffect(() => {
    const span = startTraceSpan('react.suspense.fallback.visible', { 'react.suspense.boundary': name })
    return () => span.end()
  }, [name])

  return null
}
