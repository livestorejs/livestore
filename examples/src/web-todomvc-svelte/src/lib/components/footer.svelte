<script module lang="ts">
  const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
    label: 'incompleteCount',
  })
</script>

<script lang="ts">
  import { uiState$ } from '$lib/livestore/queries'
  import { events, type schema, tables } from '$lib/livestore/schema'
  import { queryDb } from '@livestore/livestore'
  import type { SvelteStore } from '@livestore/svelte'
  let { store }: { store: SvelteStore<typeof schema> } = $props()

  const { filter } = $derived.by(store.createQuery(uiState$))
  const incompleteCount = $derived.by(store.createQuery(incompleteCount$))
  const setFilter = (filter: (typeof tables.uiState.Value)['filter']) => store.commit(events.uiStateSet({ filter }))
</script>

<footer class="footer">
  <span class="todo-count">{incompleteCount} items left</span>
  <ul class="filters">
    <li>
      <a href="#/" class={filter === 'all' ? 'selected' : ''} onclick={() => setFilter('all')}> All </a>
    </li>
    <li>
      <a href="#/" class={filter === 'active' ? 'selected' : ''} onclick={() => setFilter('active')}> Active </a>
    </li>
    <li>
      <a href="#/" class={filter === 'completed' ? 'selected' : ''} onclick={() => setFilter('completed')}>
        Completed
      </a>
    </li>
  </ul>
  <button class="clear-completed" onclick={() => store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))}>
    Clear completed
  </button>
</footer>
