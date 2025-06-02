<script module lang="ts">
  const visibleTodos$ = queryDb(
    (get) => {
      const { filter } = get(uiState$)
      return tables.todos.where({
        deletedAt: null,
        completed: filter === 'all' ? undefined : filter === 'completed',
      })
    },
    { label: 'visibleTodos' },
  )
</script>

<script lang="ts">
  import { uiState$ } from '$lib/livestore/queries'
  import { events, schema, tables } from '$lib/livestore/schema'
  import { queryDb } from '@livestore/livestore'
  import type { SvelteStore } from '@livestore/svelte'

  let { store }: { store: SvelteStore<typeof schema> } = $props()

  const toggleTodo = ({ id, completed }: typeof tables.todos.Type) =>
    store.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))

  const visibleTodos = $derived.by(store.createQuery(visibleTodos$))

  $effect(() => {
    console.log(visibleTodos)
  })
</script>

<section class="main">
  <ul class="todo-list">
    {#each visibleTodos as todo (todo.id)}
      <li>
        <div class="state">
          <input
            id="toggle-{todo.id}"
            type="checkbox"
            class="toggle"
            checked={todo.completed}
            onchange={() => toggleTodo(todo)}
          />
          <label for="toggle-{todo.id}">{todo.text}</label>
          <button
            aria-label="Delete"
            class="destroy"
            onclick={() => store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))}
          ></button>
        </div>
      </li>
    {/each}
  </ul>
</section>
