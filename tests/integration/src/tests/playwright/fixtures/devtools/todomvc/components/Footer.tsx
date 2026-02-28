/** biome-ignore-all lint/a11y: testing */
import { queryDb } from '@livestore/livestore'
import React from 'react'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Filter } from '../types.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer: React.FC = () => {
  const store = useAppStore()
  const { filter } = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)
  const setFilter = React.useCallback((filter: Filter) => store.commit(events.uiStateSet({ filter })), [store])
  const setAllFilter = React.useCallback(() => setFilter('all'), [setFilter])
  const setActiveFilter = React.useCallback(() => setFilter('active'), [setFilter])
  const setCompletedFilter = React.useCallback(() => setFilter('completed'), [setFilter])
  const clearCompleted = React.useCallback(() => {
    store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))
  }, [store])

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <a href="#/" className={filter === 'all' ? 'selected' : ''} onClick={setAllFilter}>
            All
          </a>
        </li>
        <li>
          <a href="#/" className={filter === 'active' ? 'selected' : ''} onClick={setActiveFilter}>
            Active
          </a>
        </li>
        <li>
          <a href="#/" className={filter === 'completed' ? 'selected' : ''} onClick={setCompletedFilter}>
            Completed
          </a>
        </li>
      </ul>
      <button className="clear-completed" onClick={clearCompleted}>
        Clear completed
      </button>
    </footer>
  )
}
