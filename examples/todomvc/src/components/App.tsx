import 'todomvc-app-css/index.css'

import type { QueryDefinition } from '@livestore/livestore'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import * as otel from '@opentelemetry/api'
import React from 'react'
import ReactDOM from 'react-dom/client'

import type { AppState } from '../schema'
import { schema } from '../schema.js'
import { Footer } from './Footer.js'
import { Header } from './Header.js'
import { MainSection } from './MainSection.js'

const appState: QueryDefinition = (store) =>
  store
    .querySQL<AppState>(
      () => `select newTodoText, filter from app;`,
      ['app'],
      undefined,
      undefined,
      undefined,
      otel.context.active(),
    )
    .getFirstRow()

const App = () => {
  return (
    <section className="todoapp">
      <Header />
      <MainSection />
      <Footer />
    </section>
  )
}

ReactDOM.createRoot(document.getElementById('react-app')!).render(
  <React.StrictMode>
    <LiveStoreProvider
      schema={schema}
      globalQueryDefs={{ appState } as any}
      backendOptions={{
        type: 'web',
        persistentDatabaseLocation: { virtualFilename: 'app.db', type: 'opfs' },
      }}
      fallback={<div>Loading...</div>}
      // TODO boot should also allow sync functions
      boot={async (backend) => {
        backend.execute(sql`INSERT INTO app (newTodoText, filter) VALUES ('', 'all');`)
      }}
    >
      <App />
    </LiveStoreProvider>
  </React.StrictMode>,
)
