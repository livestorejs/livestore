import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'

const documentId = 'boot:inbox'
const mailboxId = 'inbox'

export const Route = createFileRoute('/client-only/store-boot')({
  component: StoreBootPage,
})

function StoreBootPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="Store boot ensure">
      <section className="pattern-note">
        <p>
          The store boot hook in <code>src/store.ts</code> ensures <code>boot:inbox</code> while the store loads, so
          the thread list can read the client document immediately.
        </p>
        <ClientOnlyDataSummary pattern="store boot" documentId={documentId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
