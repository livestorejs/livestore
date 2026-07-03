import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'

const documentId = 'boot:inbox'

export const Route = createFileRoute('/client-only/boot-ensure')({
  component: BootEnsurePage,
})

function BootEnsurePage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="Boot ensure">
      <div className="card">
        <p>
          The store boot hook in <code>src/store.ts</code> ensures <code>boot:inbox</code> before this route renders.
        </p>
      </div>
      <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
    </DemoFrame>
  )
}
