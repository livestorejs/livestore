import type { Component } from 'solid-js'

import { queryDb } from '@livestore/livestore'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer: Component = () => {
  const store = useAppStore()
  const uiState = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)

  const setFilter = (filter: (typeof tables.uiState.Value)['filter']) => store()?.commit(events.uiStateSet({ filter }))

  return (
    <footer class="footer">
      <span class="todo-count">{incompleteCount() ?? 0} items left</span>
      <ul class="filters">
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" classList={{ selected: uiState()?.filter === 'all' }} onClick={() => setFilter('all')}>
            All
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" classList={{ selected: uiState()?.filter === 'active' }} onClick={() => setFilter('active')}>
            Active
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a
            href="#/"
            classList={{ selected: uiState()?.filter === 'completed' }}
            onClick={() => setFilter('completed')}
          >
            Completed
          </a>
        </li>
      </ul>
      <button
        type="button"
        class="clear-completed"
        onClick={() => store()?.commit(events.todoClearedCompleted({ deletedAt: new Date() }))}
      >
        Clear completed
      </button>
    </footer>
  )
}
