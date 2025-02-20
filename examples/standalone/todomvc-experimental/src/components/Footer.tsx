import { queryDb } from '@livestore/livestore'
import { useQuery, useRow, useStore } from '@livestore/react'
import React from 'react'

import { mutations, tables } from '../livestore/schema.js'
import type { Filter } from '../types.js'

const incompleteCount$ = queryDb(tables.todos.query.count().where({ completed: false, deleted: null }), {
  label: 'incompleteCount',
})

export const Footer: React.FC = () => {
  const { store } = useStore()
  const sessionId = store.sessionId
  const [{ filter }] = useRow(tables.app, sessionId)
  const incompleteCount = useQuery(incompleteCount$)

  const setFilter = (filter: Filter) => store.mutate(mutations.filterUpdated({ filter, sessionId }))

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
        onClick={() => store.mutate(mutations.todoClearedCompleted({ deleted: Date.now() }))}
      >
        Clear completed
      </button>
    </footer>
  )
}
