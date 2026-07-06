import { queryDb, Schema } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { useEnsureClientOnlyRow } from '../../ensure-client-row/use-ensure-client-only-row.ts'
import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { events, tables } from '../../schema.ts'

/**
 * Reads the source rows that will be inspected once local readiness flips.
 */
const mailboxThreads$ = (mailboxId: string) =>
  queryDb(
    {
      query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt DESC`,
      bindValues: [mailboxId],
      schema: Schema.Array(tables.threads.rowSchema),
    },
    { deps: mailboxId, label: `mailboxThreads:${mailboxId}` },
  )

export const Route = createFileRoute('/derived/default-with-readiness-marker')({
  component: DerivedDefaultPage,
})

function DerivedDefaultPage() {
  return <DerivedDefaultContent />
}

function DerivedDefaultContent() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)
  const [demoKey] = React.useState(() => `mailbox:delayed:${crypto.randomUUID()}`)
  const [sourceRowsAreReady, setSourceRowsAreReady] = React.useState(false)
  const mailboxId = demoKey
  const rowId = `derived:${demoKey}`
  const sourceThreads = store.useQuery(mailboxThreads$(mailboxId))
  const defaultThreadListUi = {
    selectedThreadId: sourceThreads[0]?.id ?? null,
    sortBy: 'receivedAt',
    sortDirection: 'desc',
  } as const
  const ensureResult = useEnsureClientOnlyRow(
    {
      tableName: tables.threadListUi.sqliteDef.name,
      id: rowId,
      default: defaultThreadListUi,
      label: sourceRowsAreReady === false ? `derived-waiting:${demoKey}` : `derived-ready:${demoKey}`,
      read: (id) => store.query(tables.threadListUi.where({ id }).first({ behaviour: 'undefined' })),
      commitEnsure: ({ id, default: defaultValue, label }) => {
        store.commit({ label }, events.threadListUiEnsured({ id, ...defaultValue }))
      },
    },
    { enabled: sourceRowsAreReady },
  )

  const simulateSourceRowsReady = React.useCallback(() => {
    const dayMs = 24 * 60 * 60 * 1000
    const newestReceivedAt = Date.now()

    store.commit(
      events.threadSynced({
        id: `${mailboxId}:001`,
        mailboxId,
        subject: 'Source row arrived first',
        receivedAt: newestReceivedAt - 3 * dayMs,
      }),
      events.threadSynced({
        id: `${mailboxId}:002`,
        mailboxId,
        subject: 'Derived default can now inspect rows',
        receivedAt: newestReceivedAt - 2 * dayMs,
      }),
      events.threadSynced({
        id: `${mailboxId}:003`,
        mailboxId,
        subject: 'Additional synced mailbox context',
        receivedAt: newestReceivedAt - dayMs,
      }),
      events.threadSynced({
        id: `${mailboxId}:004`,
        mailboxId,
        subject: 'Newest row selected by default',
        receivedAt: newestReceivedAt,
      }),
    )
    setSourceRowsAreReady(true)
  }, [mailboxId, store])

  if (ensureResult.status === 'skipped') {
    return (
      <DemoFrame title="Derived default waits for source data readiness">
        <section className="pattern-note">
          <p>
            The local source rows readiness flag is still false, so <code>useEnsureClientOnlyRow</code> is disabled and
            does not commit the client-only ensure event. This avoids persisting a guessed default from incomplete
            source data.
          </p>
          <button type="button" onClick={simulateSourceRowsReady}>
            Simulate source data becoming ready
          </button>
          <pre>{JSON.stringify({ sourceRowsAreReady, sourceThreads }, null, 2)}</pre>
        </section>
      </DemoFrame>
    )
  }

  return (
    <DemoFrame title="Derived default waits for source data readiness">
      <section className="pattern-note">
        <p>
          The local source rows readiness flag is true, so the <code>enabled</code> option allows{' '}
          <code>useEnsureClientOnlyRow</code> to run and derive the default from complete local source rows.
        </p>
        <pre>{JSON.stringify({ sourceRowsAreReady }, null, 2)}</pre>
      </section>
      <ThreadList store={store} rowId={rowId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
