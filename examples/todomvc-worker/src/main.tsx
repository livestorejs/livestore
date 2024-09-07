import 'todomvc-app-css/index.css'

import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import ExampleWorker from './example.worker.ts?worker'
import { App } from './Root.jsx'

if (import.meta.env.PROD) {
  registerSW()
}

ReactDOM.createRoot(document.getElementById('react-app')!).render(<App />)

const worker = new ExampleWorker()

const sharedWorker = new LiveStoreSharedWorker({ name: 'livestore-shared-worker-default' })

worker.postMessage({ payload: 'doesnt matter' }, [sharedWorker.port])

// ReactDOM.createRoot(document.getElementById('react-app')!).render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>,
// )
