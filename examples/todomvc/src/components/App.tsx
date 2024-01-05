import { DevtoolsLazy } from '@livestore/devtools-react'
import { sql } from '@livestore/livestore'
import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { FPSMeter } from '@schickling/fps-meter'
import React from 'react'

import { schema } from '../schema.js'
import { Footer } from './Footer.js'
import { Header } from './Header.js'
import { MainSection } from './MainSection.js'

const AppBody: React.FC = () => (
  <section className="todoapp">
    <Header />
    <MainSection />
    <Footer />
  </section>
)

export const App: React.FC = () => (
  <LiveStoreProvider
    schema={schema}
    loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' })}
    fallback={<div>Loading...</div>}
    boot={(db) => {
      console.log('booting')
      return db.execute(sql`INSERT OR IGNORE INTO app (id, newTodoText, filter) VALUES ('static', '', 'all')`)
    }}
  >
    <div style={{ top: 0, right: 0, position: 'absolute', background: '#333' }}>
      <FPSMeter height={40} />
    </div>
    <AppBody />
    <DevtoolsLazy schema={schema} />
  </LiveStoreProvider>
)
