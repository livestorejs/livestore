<script lang="ts">
import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { store } from '../livestore/store.ts'

const { newTodoText } = $derived(store.query(uiState$))
</script>

<header class="header">
	<h1>TodoMVC</h1>
	<input
		class="new-todo"
		placeholder="What needs to be done?"
		autofocus
		bind:value={
			() => newTodoText,
			(v) => store.commit(events.uiStateSet({ newTodoText: v }))
		}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				store.commit(
					events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
					events.uiStateSet({ newTodoText: '' })
				);
			}
		}}
	/>
</header>
