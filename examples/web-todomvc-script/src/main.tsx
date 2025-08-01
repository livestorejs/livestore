import { makeInMemoryAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { createStorePromise } from '@livestore/livestore'
import { events, schema, tables } from './livestore/schema.js'

// Or use makePersistedAdapter for OPFS storage
const adapter = makeInMemoryAdapter({
  devtools: { sharedWorker: LiveStoreSharedWorker },
})

const store = await createStorePromise({ adapter, schema, storeId: 'store-1' })

store.commit(events.todoCreated({ id: '1', text: 'Buy milk' }))
store.commit(events.todoCreated({ id: '2', text: 'Buy bread' }))
store.commit(events.todoCompleted({ id: '1' }))

const todos = store.query(tables.todos)
console.table(todos)

store.subscribe(tables.todos, {
  onUpdate: (todos) => {
    document.body.innerHTML = `
  <h1>Todos</h1>
  <ul>
    ${todos.map((todo) => `<li>${todo.text} ${todo.completed ? '✅' : '❌'}</li>`).join('')}
  </ul>
`
  },
})

let i = 0
setInterval(() => {
  store.commit(events.todoCreated({ id: `3-${i++}`, text: `Do something ${i}` }))
}, 1000)
