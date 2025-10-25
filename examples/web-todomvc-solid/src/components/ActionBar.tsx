import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { type Component, Show } from 'solid-js'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { store } from '../livestore/store.ts'
import type { Filter } from '../types.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

const completedCount$ = queryDb(tables.todos.count().where({ completed: true, deletedAt: null }), {
  label: 'completedCount',
})

export const ActionBar: Component = () => {
  const filter = query(uiState$, { filter: 'all', newTodoText: '' })
  const incompleteCount = query(incompleteCount$, 0)
  const completedCount = query(completedCount$, 0)

  const setFilter = (filter: Filter) => store()?.commit(events.uiStateSet({ filter }))

  return (
    <footer class="footer">
      <span class="todo-count">
        <strong>{incompleteCount()}</strong> items left
      </span>
      <ul class="filters">
        <li>
          <button type="button" classList={{ selected: filter().filter === 'all' }} onClick={() => setFilter('all')}>
            All
          </button>
        </li>
        <li>
          <button
            type="button"
            classList={{ selected: filter().filter === 'active' }}
            onClick={() => setFilter('active')}
          >
            Active
          </button>
        </li>
        <li>
          <button
            type="button"
            classList={{ selected: filter().filter === 'completed' }}
            onClick={() => setFilter('completed')}
          >
            Completed
          </button>
        </li>
      </ul>
      <Show when={completedCount() > 0}>
        <button
          type="button"
          class="clear-completed"
          onClick={() => store()?.commit(events.todoClearedCompleted({ deletedAt: new Date() }))}
        >
          Clear completed
        </button>
      </Show>
    </footer>
  )
}
