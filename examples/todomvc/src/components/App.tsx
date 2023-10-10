import 'todomvc-app-css/index.css'
import '@livestore/devtools-react/style.css'

import { AllTabsLazy, BottomDrawer } from '@livestore/devtools-react'
import type { QueryDefinition } from '@livestore/livestore'
import { sql } from '@livestore/livestore'
import { WebWorkerBackend } from '@livestore/livestore/backends/web-worker'
import { LiveStoreProvider } from '@livestore/livestore/react'
import React from 'react'
import ReactDOM from 'react-dom/client'

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

ReactDOM.createRoot(document.getElementById('react-app')!).render(
  <LiveStoreProvider
    schema={schema}
    globalQueryDefs={{ appState } as any}
    loadBackend={() =>
      WebWorkerBackend.load({ persistentDatabaseLocation: { virtualFilename: 'app.db', type: 'opfs' } })
    }
    fallback={<div>Loading...</div>}
    // TODO boot should also allow sync functions
    boot={async (backend) =>
      backend.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all');`)
    }
  >
    <App />
    <BottomDrawer>
      <React.Suspense fallback={<div>Loading...</div>}>
        <AllTabsLazy schema={schema} />
      </React.Suspense>
    </BottomDrawer>
  </LiveStoreProvider>,
)
