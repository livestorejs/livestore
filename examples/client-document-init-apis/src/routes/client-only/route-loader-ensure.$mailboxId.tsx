import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, ExampleSuspenseBoundary, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import { ensureClientDocuments } from '../../ensure-client-document.ts'
import { tables } from '../../schema.ts'

export const Route = createFileRoute('/client-only/route-loader-ensure/$mailboxId')({
  pendingComponent: () => <div className="card">Ensuring mailbox UI document…</div>,
  loader: async ({ context, params, preload }) => {
    // Avoid committing initialization events during TanStack Router link preloads.
    if (preload) return {}

    const store = await Promise.resolve(context.storeRegistry.getOrLoadPromise(context.storeOptions))
    const documentId = `loader:${params.mailboxId}`

    await ensureClientDocuments(store, [
      {
        table: tables.threadListUi,
        id: documentId,
        default: ({ store }: { readonly store: DemoStore }) => {
          const rows = store.query({
            query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt DESC LIMIT 1`,
            bindValues: [params.mailboxId],
          }) as readonly { id: string }[]

          return {
            selectedThreadId: rows[0]?.id ?? null,
            sortBy: 'receivedAt',
            sortDirection: 'desc',
          } as const
        },
        label: `route-loader:${params.mailboxId}:thread-list-ui`,
      },
    ])

    return { documentId }
  },
  component: RouteLoaderEnsurePage,
})

function RouteLoaderEnsurePage() {
  return (
    <ExampleSuspenseBoundary>
      <RouteLoaderEnsureContent />
    </ExampleSuspenseBoundary>
  )
}

function RouteLoaderEnsureContent() {
  const { storeOptions } = Route.useRouteContext()
  const { mailboxId } = Route.useParams()
  const { documentId = `loader:${mailboxId}` } = Route.useLoaderData()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="TanStack Router loader ensure">
      <section className="pattern-note">
        <p>The route loader awaited the example-local <code>ensureClientDocuments(store, specs)</code> before this component rendered.</p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
