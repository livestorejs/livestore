import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import type React from 'react'

import { uiState$ } from '../livestore/queries.js'
import { events, tables } from '../livestore/schema.js'
import type { Filter } from '../types.js'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer: React.FC = () => {
  const { store } = useStore()
  const { filter } = useQuery(uiState$)
  const incompleteCount = useQuery(incompleteCount$)

  const setFilter = (filter: Filter) => store.commit(events.uiStateSet({ filter }))

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            All
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" className={filter === 'active' ? 'selected' : ''} onClick={() => setFilter('active')}>
            Active
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" className={filter === 'completed' ? 'selected' : ''} onClick={() => setFilter('completed')}>
            Completed
          </a>
        </li>
      </ul>
      <button
        type="button"
        className="clear-completed"
        onClick={() => store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))}
      >
        Clear completed
      </button>
    </footer>
  )
}
