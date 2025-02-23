import 'todomvc-app-css/index.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

// import { registerSW } from 'virtual:pwa-register'
import { App } from './Root.jsx'

// if (import.meta.env.PROD) {
//   registerSW()
// }

// NOTE it's important that we kick of the js app via an async task, so the browser can do the initial paint asap
const main = async () => {
  const tmpRoot = document.createElement('div')
  tmpRoot.id = 'tmp-root'

  const root = document.getElementById('react-app')!

  const appData = await fetch('/app-123.db')
    .then((res) => res.arrayBuffer())
    .then((buf) => new Uint8Array(buf))

  // ReactDOM.hydrateRoot(document.getElementById('react-app')!, <App />)
  // ReactDOM.createRoot(document.getElementById('react-app')!).render(<App />)
  ReactDOM.createRoot(tmpRoot).render(
    <App
      initialData={appData}
      ready={() => {
        root.replaceWith(tmpRoot)
      }}
    />,
  )

  // ReactDOM.createRoot(document.getElementById('react-app')!).render(
  //   <React.StrictMode>
  //     <App />
  //   </React.StrictMode>,
  // )
}

main()
