import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { DemoFrame, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import { ensureClientDocuments } from '../../ensure-client-document.ts'
import { withTraceSpan } from '../../otel.ts'
import { tables } from '../../schema.ts'

export const Route = createFileRoute('/client-only/component-ensure-if-ready/$mailboxId')({
  component: ComponentEnsureIfReadyPage,
})

function ComponentEnsureIfReadyPage() {
  return <ComponentEnsureIfReadyContent />
}

function ComponentEnsureIfReadyContent() {
  const { storeOptions } = Route.useRouteContext()
  const { mailboxId } = Route.useParams()
  const store = useStore(storeOptions)
  const documentId = `component-if-ready:${mailboxId}`
  const isDocumentReady = useEnsureThreadListUiDocument({ store, mailboxId, documentId })

  if (isDocumentReady === false) return null

  return (
    <DemoFrame title="Component ensure with readiness guard">
      <section className="pattern-note">
        <p>
          The component returns <code>null</code> until the hook has ensured the client document, then falls through to
          the thread list.
        </p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}

function useEnsureThreadListUiDocument({
  store,
  mailboxId,
  documentId,
}: {
  readonly store: DemoStore
  readonly mailboxId: string
  readonly documentId: string
}): boolean {
  const [isReady, setIsReady] = React.useState(false)
  const [ensureError, setEnsureError] = React.useState<unknown>()

  React.useEffect(() => {
    let cancelled = false
    setIsReady(false)
    setEnsureError(undefined)

    withTraceSpan(
      'component.readiness_guard.ensure',
      { 'mailbox.id': mailboxId, 'client_document.id': documentId },
      () =>
        ensureClientDocuments(store, [
          {
            table: tables.threadListUi,
            id: documentId,
            default: ({ store }: { readonly store: DemoStore }) => {
              const rows = store.query({
                query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt DESC LIMIT 1`,
                bindValues: [mailboxId],
              }) as readonly { id: string }[]

              return {
                selectedThreadId: rows[0]?.id ?? null,
                sortBy: 'receivedAt',
                sortDirection: 'desc',
              } as const
            },
            label: `component-if-ready:${mailboxId}:thread-list-ui`,
          },
        ]),
    ).then(
      ([result]) => {
        if (cancelled) return
        if (result === undefined) {
          setEnsureError(new Error('Expected ensureClientDocuments to return one result'))
          return
        }

        setIsReady(true)
      },
      (error: unknown) => {
        if (cancelled === false) setEnsureError(error)
      },
    )

    return () => {
      cancelled = true
    }
  }, [documentId, mailboxId, store])

  if (ensureError !== undefined) throw ensureError
  return isReady
}
