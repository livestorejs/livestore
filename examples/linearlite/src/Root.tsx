import { LiveStoreProvider } from '@livestore/livestore/react'
import { WebWorkerStorage } from '@livestore/livestore/storage/web-worker'
import { schema } from './domain/schema'
import App from './App'

export default function Root() {
  return (
    <LiveStoreProvider
      schema={schema}
      loadStorage={() => WebWorkerStorage.load({ fileName: 'app.db', type: 'opfs' })}
      fallback={<div>Loading...</div>}
    >
      <App />
    </LiveStoreProvider>
  )
}
