<script lang="ts">
	import { queryDb } from '@livestore/livestore';
	import { uiState$ } from '../livestore/queries';
	import { events, tables } from '../livestore/schema';
	import { store } from '../livestore/store';

	const { filter } = $derived(store.query(uiState$));

	const setFilter = (filter: (typeof tables.uiState.Value)['filter']) => {
		store.commit(events.uiStateSet({ filter }));
	};

	const incompleteCount$ = queryDb(
		tables.todos.count().where({ completed: false, deletedAt: null }),
		{
			label: 'incompleteCount'
		}
	);
</script>

<footer class="footer">
	<span class="todo-count">{store.query(incompleteCount$)} items left</span>

	<ul class="filters">
		<li>
			<a
				href="#/"
				class={filter === 'all' ? 'selected' : ''}
				onclick={() => setFilter('all')}
			>
				All
			</a>
		</li>
		<li>
			<a
				href="#/"
				class={filter === 'active' ? 'selected' : ''}
				onclick={() => setFilter('active')}
			>
				Active
			</a>
		</li>
		<li>
			<a
				href="#/"
				class={filter === 'completed' ? 'selected' : ''}
				onclick={() => setFilter('completed')}
			>
				Completed
			</a>
		</li>
	</ul>

	<button
		class="clear-completed"
		onclick={() => {
			store.commit(events.todoClearedCompleted({ deletedAt: new Date() }));
		}}
	>
		Clear completed
	</button>
</footer>
