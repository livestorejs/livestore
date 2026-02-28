import { useCallback } from 'react'

import { queryDb } from '@livestore/livestore'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer = () => {
  const store = useAppStore()
  const { filter } = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)
  const setFilter = useCallback(
    (filter: (typeof tables.uiState.Value)['filter']) => store.commit(events.uiStateSet({ filter })),
    [store],
  )
  const handleAllClick = useCallback(() => setFilter('all'), [setFilter])
  const handleActiveClick = useCallback(() => setFilter('active'), [setFilter])
  const handleCompletedClick = useCallback(() => setFilter('completed'), [setFilter])
  const handleClearCompleted = useCallback(
    () => store.commit(events.todoClearedCompleted({ deletedAt: new Date() })),
    [store],
  )

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" className={filter === 'all' ? 'selected' : ''} onClick={handleAllClick}>
            All
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" className={filter === 'active' ? 'selected' : ''} onClick={handleActiveClick}>
            Active
          </a>
        </li>
        <li>
          {/* biome-ignore lint/a11y/useValidAnchor: TodoMVC standard convention for filter buttons */}
          <a href="#/" className={filter === 'completed' ? 'selected' : ''} onClick={handleCompletedClick}>
            Completed
          </a>
        </li>
      </ul>
      <button
        type="button"
        className="clear-completed"
        onClick={handleClearCompleted}
      >
        Clear completed
      </button>
    </footer>
  )
}
