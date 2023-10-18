import 'todomvc-app-css/index.css'
import '@livestore/devtools-react/style.css'

import { AllTabsLazy, BottomDrawer } from '@livestore/devtools-react'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import React from 'react'
import ReactDOM from 'react-dom/client'

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

ReactDOM.createRoot(document.getElementById('react-app')!).render(
  <LiveStoreProvider
    schema={schema}
    loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' })}
    fallback={<div>Loading...</div>}
    boot={(db) => db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all')`)}
  >
    <App />
    <BottomDrawer>
      <React.Suspense fallback={<div>Loading...</div>}>
        <AllTabsLazy schema={schema} />
      </React.Suspense>
    </BottomDrawer>
  </LiveStoreProvider>,
)
