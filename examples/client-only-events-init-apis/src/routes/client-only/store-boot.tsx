import { createFileRoute } from '@tanstack/react-router'

import { useStore } from '@livestore/react'

import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'

const rowId = 'boot:inbox'
const mailboxId = 'inbox'

export const Route = createFileRoute('/client-only/store-boot')({
  component: StoreBootPage,
})

function StoreBootPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  /**
   * Check the src/store.ts boot function for the example.
   */
  return (
    <DemoFrame title="Store boot ensure">
      <section className="pattern-note">
        <p>
          The store boot hook in <code>src/store.ts</code> commits an explicit ensure event while the store loads, so
          the thread list can read the client-only row immediately.
        </p>
        <ClientOnlyDataSummary pattern="store boot" rowId={rowId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} rowId={rowId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
