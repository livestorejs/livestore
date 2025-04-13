import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import React from 'react'

import { app$ } from '../livestore/queries.js'
import { events, tables } from '../livestore/schema.js'
import type { Filter } from '../types.js'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

export const Footer: React.FC = () => {
  const { store } = useStore()
  const { filter } = useQuery(app$)
  const incompleteCount = useQuery(incompleteCount$) ?? 0

  const setFilter = (filter: Filter) => {
    store.commit(events.uiStateSet({ filter }))
  }

  return (
    <footer className="footer">
      <span className="todo-count">{typeof incompleteCount === 'number' ? incompleteCount : 0} items left</span>
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
        onClick={() => {
          store.commit(events.todoClearedCompleted({ deletedAt: new Date() }))
        }}
      >
        Clear completed
      </button>
    </footer>
  )
}
