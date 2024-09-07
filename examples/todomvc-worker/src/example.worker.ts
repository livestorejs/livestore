import { Schema } from '@effect/schema'
import { createStorePromise, querySQL } from '@livestore/livestore'
import { makeAdapter } from '@livestore/web'

import LiveStoreWorker from './livestore.worker?worker'
import { mutations, schema, tables } from './schema/index.js'

self.name = 'example-worker'

const main = async () => {
  console.log('Booted example worker')
}

addEventListener('message', (event) => {
  const port = event.ports[0]!
  console.log('received message from main thread', event)
  bootAdapter(port)
  // console.log('message from main thread', event)
})

const bootAdapter = async (sharedWorker: MessagePort) => {
  const adapter = makeAdapter({
    storage: { type: 'opfs' },
    worker: LiveStoreWorker,
    sharedWorker,
  })

  const store = await createStorePromise({
    adapter,
    schema,
  })

  // let toggle = true

  const todos$ = querySQL(`select * from todos`, {
    schema: Schema.Array(tables.todos.schema),
    queriedTables: new Set(['todos']),
  })

  console.log('todos$', todos$)

  todos$.subscribe(console.log)

  setInterval(() => {
    // if (toggle) {
    //   const result = store.select(`select * from todos`)
    //   console.log('result', result)
    // } else {
    const id = Date.now().toString()
    store.mutate(mutations.addTodo({ id, text: 'new todo ' + id }))
    // }
    // toggle = !toggle
  }, 1000)
}

main().catch(console.error)
