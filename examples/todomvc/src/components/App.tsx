import 'todomvc-app-css/index.css'
import '@livestore/devtools-react/style.css'

import { AllTabsLazy, BottomDrawer } from '@livestore/devtools-react'
import type { QueryDefinition } from '@livestore/livestore'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import type { AppState } from '../schema.js'
import { schema } from '../schema.js'
import { Footer } from './Footer.js'
import { Header } from './Header.js'
import { MainSection } from './MainSection.js'

const appState: QueryDefinition = (store) =>
  store.querySQL<AppState>(() => `select newTodoText, filter from app;`, { queriedTables: ['app'] }).getFirstRow()

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
    globalQueryDefs={{ appState } as any}
    loadStorage={() => WebWorkerStorage.load({ virtualFilename: 'app.db', type: 'opfs' })}
    fallback={<div>Loading...</div>}
    boot={(db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');`)}
  >
    <App />
    <BottomDrawer>
      <React.Suspense fallback={<div>Loading...</div>}>
        <AllTabsLazy schema={schema} />
      </React.Suspense>
    </BottomDrawer>
  </LiveStoreProvider>,
)
