import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider } from '@livestore/react'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import LiveStoreWorker from '../devtools/todomvc/livestore/livestore.worker.ts?worker'
import { schema } from '../devtools/todomvc/livestore/schema.ts'

const useBarrierStart = () => {
  const [started, setStarted] = React.useState(false)
  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const barrier = sp.get('barrier') !== null
    if (!barrier) {
      setStarted(true)
      return
    }
    const bc = new BroadcastChannel('ls-webtest')
    const onMsg = (ev: MessageEvent) => {
      if (ev.data && ev.data.type === 'go') {
        setStarted(true)
      }
    }
    bc.addEventListener('message', onMsg)
    // Let the test know this page is waiting at the barrier
    bc.postMessage({ type: 'ready' })
    return () => {
      bc.removeEventListener('message', onMsg)
      bc.close()
    }
  }, [])
  return started
}

export const Root: React.FC = () => {
  const started = useBarrierStart()

  const sp = new URLSearchParams(window.location.search)
  const reset = sp.get('reset') !== null
  const sessionId = sp.get('sessionId') ?? undefined
  const clientId = sp.get('clientId') ?? undefined
  const disableFastPath = sp.get('disableFastPath') !== null
  const bootDelayMs = (() => {
    const v = sp.get('bootDelayMs')
    return v !== null ? Number(v) : 0
  })()

  const [canBoot, setCanBoot] = React.useState(false)
  React.useEffect(() => {
    if (!started) return
    const t = setTimeout(() => setCanBoot(true), bootDelayMs)
    return () => clearTimeout(t)
  }, [started, bootDelayMs])

  const adapter = React.useMemo(
    () =>
      canBoot
        ? makePersistedAdapter({
            storage: { type: 'opfs' },
            worker: LiveStoreWorker,
            sharedWorker: LiveStoreSharedWorker,
            resetPersistence: reset,
            sessionId,
            clientId,
            experimental: { disableFastPath },
          })
        : undefined,
    [canBoot, reset, sessionId, clientId, disableFastPath],
  )

  if (!started) {
    return <div>Waiting for barrier…</div>
  }

  if (adapter === undefined) {
    return <div>Waiting delay…</div>
  }

  const renderError = () => <div data-webtest="error">Error</div>
  const renderShutdown = () => <div data-webtest="shutdown">Shutdown</div>

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      renderError={renderError}
      renderShutdown={renderShutdown}
    >
      <div>Adapter Web Test App</div>
    </LiveStoreProvider>
  )
}
