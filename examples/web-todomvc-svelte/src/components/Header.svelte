<script lang="ts">
  import { events } from '../livestore/schema.js'
  import { uiState$ } from '../livestore/queries.js'
  import { store } from '../livestore/store';

  let { newTodoText } = $derived(store.query(uiState$))
  const updatedNewTodoText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))
  const todoCreated = () =>
    store.commit(
      events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      events.uiStateSet({ newTodoText: '' }),
    )
</script>

<header class="header">
  <h1>TodoMVC</h1>
  <input
    class="new-todo"
    placeholder="What needs to be done?"
    autofocus
    bind:value={() => newTodoText, (v) => updatedNewTodoText(v)}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        todoCreated()
      }
    }}
  />
</header>
