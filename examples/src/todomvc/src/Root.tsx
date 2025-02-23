import { makeAdapter, makeInMemoryAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { Adapter } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/react'
import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

import { Footer } from './components/Footer.js'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'
import LiveStoreWorker from './livestore.worker?worker'
import { schema } from './livestore/schema.js'
// import { makeTracer } from './otel.js'

const startTime = performance.now()

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

// const resetPersistence = import.meta.env.DEV && new URLSearchParams(window.location.search).get('reset') !== null

// if (resetPersistence) {
//   const searchParams = new URLSearchParams(window.location.search)
//   searchParams.delete('reset')
//   window.history.replaceState(null, '', `${window.location.pathname}?${searchParams.toString()}`)
// }

// {
// storage: { type: 'opfs' },
// worker: LiveStoreWorker,
// sharedWorker: LiveStoreSharedWorker,

// resetPersistence,
// })

// const otelTracer = makeTracer('todomvc-main')

// export const App: React.FC<{ ready: () => void; initialData?: Uint8Array }> = ({ ready, initialData }) => {
//   // const [adapter, setAdapter] = React.useState<{ adapter: Adapter } | undefined>()

//   // React.useEffect(() => {
//   //   ;(async () => {
//   //     // const appData = await fetch(new URL('./app-123.db', BASE_URL))
//   //     //   .then((res) => res.arrayBuffer())
//   //     //   .then((buf) => new Uint8Array(buf))

//   //     // const adapter = makeInMemoryAdapter(appData)
//   //     const adapter = makeInMemoryAdapter()
//   //     setAdapter({ adapter })
//   //   })()
//   // }, [BASE_URL])

//   // if (adapter === undefined) {
//   //   return null
//   // }

//   const adapter = makeInMemoryAdapter(initialData)

//   return <App_ ready={ready} adapter={adapter} />
// }
export const App: React.FC<{ ready: () => void; initialData?: Uint8Array; isServerSide?: boolean }> = ({
  ready,
  initialData,
  isServerSide = false,
}) => {
  const adapter = makeInMemoryAdapter(initialData)
  return (
    <LiveStoreProvider
      schema={schema}
      renderLoading={(_) => <div>Loading LiveStore ({_.stage})...</div>}
      adapter={adapter}
      batchUpdates={batchUpdates}
    >
      <Ready ready={ready} />
      <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>{/* <FPSMeter height={40} /> */}</div>
      <div style={{ filter: isServerSide ? 'blur(2px)' : 'none', transition: 'filter 0.2s' }}>
        <AppBody />
      </div>
    </LiveStoreProvider>
  )
}

const Ready: React.FC<{ ready: () => void }> = ({ ready }) => {
  React.useEffect(() => {
    const endTime = performance.now()
    console.log(`Interactivity ready in ${endTime - startTime}ms`)
    ready()
  }, [ready])

  return null
}
