<script lang="ts">
  import { makePersistedAdapter } from '@livestore/adapter-web'
  import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
  import { queryDb } from '@livestore/livestore'
  import { createStore } from '@livestore/svelte'

  import LiveStoreWorker from './livestore.worker.ts?worker'
  import { schema, tables } from './schema.ts'

  const adapter = makePersistedAdapter({
    storage: { type: 'opfs' },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
  })

  const store = await createStore<typeof schema>({
    adapter,
    schema,
    storeId: 'default',
  })

  const todos$ = queryDb(tables.todos.where({ completed: false }), {
    label: 'todos',
  })
</script>

<ul>
  {#each store.query(todos$) as todo (todo.id)}
    <li>{todo.text}</li>
  {/each}
</ul>
