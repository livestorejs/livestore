import { DevtoolsLazy } from '@livestore/devtools-react'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { makeAdapter } from '@livestore/web'
import { FPSMeter } from '@schickling/fps-meter'
import React from 'react'

import { Footer } from './components/Footer.js'
import { Header } from './components/Header.js'
import { MainSection } from './components/MainSection.js'
import LiveStoreWorker from './livestore.worker?worker'
import { schema } from './schema/index.js'

// console.log('schemaUrl', new URL('./schema/index.ts', import.meta.url).toString())

// const url = new URL('./schema/index.ts', import.meta.url)
// console.log('Chunk URL:', url.href)

// const x = import(url.href)
// console.log('x', x)

// @ts-expect-error xxx
window._schema = schema

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

const syncing =
  import.meta.env.VITE_LIVESTORE_SYNC_URL && import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID
    ? {
        type: 'websocket' as const,
        url: import.meta.env.VITE_LIVESTORE_SYNC_URL,
        roomId: `todomvc-${import.meta.env.VITE_LIVESTORE_SYNC_ROOM_ID}`,
      }
    : undefined

const adapter = makeAdapter({ storage: { type: 'opfs' }, worker: LiveStoreWorker, syncing })

export const App: React.FC = () => (
  <LiveStoreProvider schema={schema} fallback={<div>Loading...</div>} adapter={adapter}>
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
    {/* <DevtoolsLazy schema={schema} /> */}
  </LiveStoreProvider>
)
