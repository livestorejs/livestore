<script lang="ts">
import { queryDb } from '@livestore/livestore'
import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { store } from '../livestore/store.ts'

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

<section class="main">
	<ul class="todo-list">
		{#each store.query(visibleTodos$) as todo (todo.id)}
			<li>
				<div class="state">
					<input
						id="toggle-{todo.id}"
						type="checkbox"
						class="toggle"
						checked={todo.completed}
						onchange={() =>
							store.commit(
								todo.completed
									? events.todoUncompleted(todo)
									: events.todoCompleted(todo)
							)}
					/>
					<label for="toggle-{todo.id}">{todo.text}</label>
					<button
						aria-label="Delete"
						class="destroy"
						onclick={() =>
							store.commit(
								events.todoDeleted({ id: todo.id, deletedAt: new Date() })
							)}
					></button>
				</div>
			</li>
		{/each}
	</ul>
</section>
