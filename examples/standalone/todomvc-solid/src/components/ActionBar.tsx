import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { type Component, Show } from 'solid-js'

import { uiState$ } from '../livestore/queries.js'
import { events, tables } from '../livestore/schema.js'
import { store } from '../livestore/store.js'
import type { Filter } from '../types.js'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: undefined }), {
  label: 'incompleteCount',
})

const completedCount$ = queryDb(tables.todos.count().where({ completed: true, deletedAt: undefined }), {
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
          <a href="#/" classList={{ selected: filter().filter === 'all' }} onClick={() => setFilter('all')}>
            All
          </a>
        </li>
        <li>
          <a href="#/" classList={{ selected: filter().filter === 'active' }} onClick={() => setFilter('active')}>
            Active
          </a>
        </li>
        <li>
          <a href="#/" classList={{ selected: filter().filter === 'completed' }} onClick={() => setFilter('completed')}>
            Completed
          </a>
        </li>
      </ul>
      <Show when={completedCount() > 0}>
        <button
          class="clear-completed"
          onClick={() => store()?.commit(events.todoClearedCompleted({ deletedAt: new Date() }))}
        >
          Clear completed
        </button>
      </Show>
    </footer>
  )
}
