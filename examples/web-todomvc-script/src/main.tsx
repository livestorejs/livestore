import { makeInMemoryAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { createStorePromise, liveStoreVersion } from '@livestore/livestore'
import { makeWsSync } from '@livestore/sync-cf/client'
import { events, SyncPayload, schema, tables } from './livestore/schema.ts'

// Or use makePersistedAdapter for OPFS storage
const adapter = makeInMemoryAdapter({
  devtools: { sharedWorker: LiveStoreSharedWorker },
  sync: {
    backend: makeWsSync({ url: `${globalThis.location.origin}/sync` }),
    initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
  },
})

const syncPayload = { authToken: 'insecure-token-change-me' }

const store = await createStorePromise({
  adapter,
  schema,
  storeId: 'store-1',
  syncPayloadSchema: SyncPayload,
  syncPayload,
})

// Add version badge
console.log(`LiveStore v${liveStoreVersion}`)
const versionBadge = document.createElement('div')
versionBadge.textContent = `v${liveStoreVersion}`
versionBadge.style.cssText = `
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  color: white;
  z-index: 1000;
  user-select: none;
`
document.body.appendChild(versionBadge)

store.commit(events.todoCreated({ id: '1', text: 'Buy milk' }))
store.commit(events.todoCreated({ id: '2', text: 'Buy bread' }))
store.commit(events.todoCompleted({ id: '1' }))

const todos = store.query(tables.todos)
console.table(todos)

store.subscribe(tables.todos, (todos) => {
  document.body.innerHTML = `
  <h1>Todos</h1>
  <ul>
    ${todos.map((todo) => `<li>${todo.text} ${todo.completed ? '✅' : '❌'}</li>`).join('')}
  </ul>
`
})

let i = 0
setInterval(() => {
  store.commit(events.todoCreated({ id: `3-${i++}`, text: `Do something ${i}` }))
}, 1000)
