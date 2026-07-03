import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import { ensureClientDocument } from '../../ensure-client-document.ts'
import { withTraceSpan } from '../../otel.ts'
import { tables } from '../../schema.ts'

export const Route = createFileRoute('/client-only/route-loader-ensure/$mailboxId')({
  pendingComponent: () => <div className="card">Ensuring mailbox UI document…</div>,
  loader: async ({ context, params, preload }) => {
    return withTraceSpan(
      'route.loader.ensure',
      {
        'route.id': '/client-only/route-loader-ensure/$mailboxId',
        'mailbox.id': params.mailboxId,
        'route.preload': preload,
      },
      async (span) => {
        // Avoid committing initialization events during TanStack Router link preloads.
        if (preload) return {}

        const store = await Promise.resolve(context.storeRegistry.getOrLoadPromise(context.storeOptions))
        const documentId = `loader:${params.mailboxId}`
        span.setAttribute('client_document.id', documentId)

        await ensureClientDocument(store, {
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
        })

        return { documentId }
      },
    )
  },
  component: RouteLoaderEnsurePage,
})

function RouteLoaderEnsurePage() {
  return <RouteLoaderEnsureContent />
}

function RouteLoaderEnsureContent() {
  const { storeOptions } = Route.useRouteContext()
  const { mailboxId } = Route.useParams()
  const { documentId = `loader:${mailboxId}` } = Route.useLoaderData()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="TanStack Router loader ensure">
      <section className="pattern-note">
        <p>
          The route loader awaited the example-local <code>ensureClientDocument(store, spec)</code> before this
          component rendered.
        </p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
