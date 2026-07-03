import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, ExampleSuspenseBoundary, ThreadList } from '../../components/DemoFrame.tsx'

const documentId = 'boot:inbox'

export const Route = createFileRoute('/client-only/boot-ensure')({
  component: BootEnsurePage,
})

function BootEnsurePage() {
  return (
    <ExampleSuspenseBoundary>
      <BootEnsureContent />
    </ExampleSuspenseBoundary>
  )
}

function BootEnsureContent() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="Boot ensure">
      <section className="pattern-note">
        <p>
          The store boot hook in <code>src/store.ts</code> ensures <code>boot:inbox</code> during async store loading.
          This route's Suspense boundary waits for <code>useStore</code> before rendering the thread list.
        </p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
    </DemoFrame>
  )
}
