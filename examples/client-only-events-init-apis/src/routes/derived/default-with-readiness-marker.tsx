import { queryDb, Schema } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { useEnsureClientOnlyRow } from '../../ensure-client-row/use-ensure-client-only-row.ts'
import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { events, tables } from '../../schema.ts'

/**
 * App-level persisted marker that means the source data for `key` is now safe to read.
 *
 * Without this record, an empty source query is ambiguous: the backend may have
 * no rows, or sync may simply not have delivered the rows yet.
 *
 * This route uses the marker to demonstrate `useEnsureClientOnlyRow`'s `enabled`
 * option: skip the ensure step until the source rows are ready.
 */
interface SourceDataReadyRecord {
  /** Domain key for the source data that is ready. */
  readonly key: string

  /** Monotonic source revision used to make initialization decisions explicit. */
  readonly revision: number
}

const sourceDataReadyRecord$ = (key: string) =>
  queryDb(
    {
      query: `SELECT * FROM sourceDataReady WHERE key = ?`,
      bindValues: [key],
      schema: Schema.Array(tables.sourceDataReady.rowSchema),
    },
    { deps: key, label: `sourceDataReady:${key}` },
  )

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
  const mailboxId = demoKey
  const rowId = `derived:${demoKey}`
  const sourceDataReadyRecords = store.useQuery(sourceDataReadyRecord$(demoKey))
  const sourceDataReadyRecord: SourceDataReadyRecord | undefined = sourceDataReadyRecords[0]
  const sourceDataIsReady = sourceDataReadyRecord !== undefined
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
      label:
        sourceDataReadyRecord === undefined
          ? `derived-waiting:${demoKey}`
          : `derived-ready:${sourceDataReadyRecord.key}:${sourceDataReadyRecord.revision}`,
      read: (id) => store.query(tables.threadListUi.where({ id }).first({ behaviour: 'undefined' })),
      commitEnsure: ({ id, default: defaultValue, label }) => {
        store.commit({ label }, events.threadListUiEnsured({ id, ...defaultValue }))
      },
    },
    { enabled: sourceDataIsReady },
  )

  const simulateSourceDataReady = React.useCallback(() => {
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
      events.sourceDataReady({ key: demoKey, revision: 1 }),
    )
  }, [demoKey, mailboxId, store])

  if (ensureResult.status === 'skipped') {
    return (
      <DemoFrame title="Derived default waits for source data readiness">
        <section className="pattern-note">
          <p>
            The persisted <code>sourceDataReady</code> marker does not exist yet, so{' '}
            <code>useEnsureClientOnlyRow</code> is disabled through its <code>enabled</code> option and does not
            commit the client-only ensure event. This avoids persisting a guessed default from incomplete synced data.
          </p>
          <button type="button" onClick={simulateSourceDataReady}>
            Simulate source data becoming ready
          </button>
          <pre>{JSON.stringify({ sourceDataIsReady, sourceDataReadyRecord, sourceThreads }, null, 2)}</pre>
        </section>
      </DemoFrame>
    )
  }

  return (
    <DemoFrame title="Derived default waits for source data readiness">
      <section className="pattern-note">
        <p>
          The persisted <code>sourceDataReady</code> marker exists, so the <code>enabled</code> option allows{' '}
          <code>useEnsureClientOnlyRow</code> to run and derive the default from complete local source rows.
        </p>
        <pre>{JSON.stringify(sourceDataReadyRecord, null, 2)}</pre>
      </section>
      <ThreadList store={store} rowId={rowId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
