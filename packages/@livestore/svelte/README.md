# @livestore/svelte

Svelte bindings for LiveStore. The `createStore` helper wires LiveStore queries into Svelte reactivity so `$effect` blocks rerun when query results change and abort signals propagate on teardown.

## Usage

```svelte
<script lang="ts">
  import { queryDb } from '@livestore/livestore'
  import { createStore } from '@livestore/svelte'

  import { adapter } from './livestore/adapter.ts'
  import { schema, tables } from './livestore/schema.ts'

  const store = await createStore<typeof schema>({ adapter, schema, storeId: 'default' })
  const todos$ = queryDb(tables.todos.where({ completed: false }), { label: 'todos' })
</script>

<ul>
  {#each store.query(todos$) as todo (todo.id)}
    <li>{todo.text}</li>
  {/each}
</ul>
```

## Development

- Build: `pnpm --filter @livestore/svelte build`
- Test: `pnpm --filter @livestore/svelte test`
