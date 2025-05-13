import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import React from 'react'

import { uiState$ } from '../livestore/queries.js'
import { events, tables } from '../livestore/schema.js'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer: React.FC = () => {
  const { store } = useStore()
  const { filter } = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)
  const setFilter = (filter: (typeof tables.uiState.Value)['filter']) => store.commit(events.uiStateSet({ filter }))

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <a href="#/" className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            All
          </a>
        </li>
        <li>
          <a href="#/" className={filter === 'active' ? 'selected' : ''} onClick={() => setFilter('active')}>
            Active
          </a>
        </li>
        <li>
          <a href="#/" className={filter === 'completed' ? 'selected' : ''} onClick={() => setFilter('completed')}>
            Completed
          </a>
        </li>
      </ul>
      <button
        className="clear-completed"
        onClick={() => store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))}
      >
        Clear completed
      </button>
    </footer>
  )
}
