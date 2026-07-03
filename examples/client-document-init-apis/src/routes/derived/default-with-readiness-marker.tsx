import { queryDb, Schema } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { DemoFrame, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import { events, tables } from '../../schema.ts'
import { useEnsureDerivedClientDocumentsSuspense } from '../../use-ensure-client-documents-suspense.ts'

/**
 * App-level record that means the source data for `key` is now safe to read.
 *
 * Without this record, an empty source query is ambiguous: the backend may have
 * no rows, or sync may simply not have delivered the rows yet.
 */
interface SourceReadyRecord {
  /** Domain key for the source data that is ready. */
  readonly key: string

  /** Monotonic source revision used to make initialization decisions explicit. */
  readonly revision: number
}

const sourceReadyRecord$ = (key: string) =>
  queryDb(
    {
      query: `SELECT * FROM sourceReady WHERE key = ?`,
      bindValues: [key],
      schema: Schema.Array(tables.sourceReady.rowSchema),
    },
    { deps: key, label: `sourceReady:${key}` },
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
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)
  const [demoKey] = React.useState(() => `mailbox:delayed:${crypto.randomUUID()}`)
  const mailboxId = demoKey
  const documentId = `derived:${demoKey}`
  const sourceReadyRecords = store.useQuery(sourceReadyRecord$(demoKey))
  const sourceReadyRecord: SourceReadyRecord | undefined = sourceReadyRecords[0]
  const sourceIsReady = sourceReadyRecord !== undefined
  const sourceThreads = store.useQuery(mailboxThreads$(mailboxId))
  const derivedEnsureResult = useEnsureDerivedClientDocumentsSuspense(store, {
    sourceReady: sourceIsReady,
    documents: [
      {
        table: tables.threadListUi,
        id: documentId,
        default: (ctx: { store: DemoStore }) => {
          const rows = ctx.store.query({
            query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt DESC LIMIT 1`,
            bindValues: [mailboxId],
          }) as readonly { id: string }[]

          return { selectedThreadId: rows[0]?.id ?? null, sortBy: 'receivedAt', sortDirection: 'desc' } as const
        },
        label:
          sourceReadyRecord === undefined
            ? `derived-waiting:${demoKey}`
            : `derived-ready:${sourceReadyRecord.key}:${sourceReadyRecord.revision}`,
      },
    ],
  })

  const simulateSourceReady = React.useCallback(() => {
    store.commit(
      events.threadSynced({
        id: `${mailboxId}:001`,
        mailboxId,
        subject: 'Arrived after source became ready',
        receivedAt: Date.now(),
      }),
      events.sourceReady({ key: demoKey, revision: 1 }),
    )
  }, [demoKey, mailboxId, store])

  if (derivedEnsureResult.sourceReady === false) {
    return (
      <DemoFrame title="Derived default waits for sourceReady">
        <section className="pattern-note">
          <p>
            The source mailbox is not ready yet, so <code>ensureDerivedClientDocumentsExist</code> does not create the
            client document. This avoids persisting a guessed default from incomplete synced data.
          </p>
          <button type="button" onClick={simulateSourceReady}>
            Simulate source data becoming ready
          </button>
          <pre>{JSON.stringify({ sourceIsReady, sourceReadyRecord, sourceThreads }, null, 2)}</pre>
        </section>
      </DemoFrame>
    )
  }

  return (
    <DemoFrame title="Derived default waits for sourceReady">
      <section className="pattern-note">
        <p>
          The <code>sourceReady</code> record exists, so <code>ensureDerivedClientDocumentsExist</code> delegates to
          <code> ensureClientDocuments</code> and derives the default from local source rows.
        </p>
        <pre>{JSON.stringify(sourceReadyRecord, null, 2)}</pre>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
