import 'todomvc-app-css/index.css'
import '@livestore/devtools-react/style.css'

import { DevtoolsLazy } from '@livestore/devtools-react'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import { schema } from '../schema.js'
import { Footer } from './Footer.js'
import { Header } from './Header.js'
import { MainSection } from './MainSection.js'

const App = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

if (import.meta.env.PROD) {
  registerSW()
}

ReactDOM.createRoot(document.getElementById('react-app')!).render(
  <LiveStoreProvider
    schema={schema}
    loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' })}
    fallback={<div>Loading...</div>}
    boot={(db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all')`)}
  >
    <App />
    <DevtoolsLazy schema={schema} />
  </LiveStoreProvider>,
)
