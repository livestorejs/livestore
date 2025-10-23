import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type React from 'react'
import { NavLink } from 'react-router-dom'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

type Filter = (typeof tables.uiState.Value)['filter']

export const Footer: React.FC = () => {
  const { store } = useStore()
  const { filter } = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)
  const handleFilterClick = (nextFilter: Filter) => {
    if (filter !== nextFilter) {
      store.commit(events.uiStateSet({ filter: nextFilter }))
    }
  }

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <NavLink
            to="/"
            className={({ isActive }) => (isActive ? 'selected' : undefined)}
            onClick={() => handleFilterClick('all')}
            preventScrollReset
          >
            All
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/active"
            className={({ isActive }) => (isActive ? 'selected' : undefined)}
            onClick={() => handleFilterClick('active')}
            preventScrollReset
          >
            Active
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/completed"
            className={({ isActive }) => (isActive ? 'selected' : undefined)}
            onClick={() => handleFilterClick('completed')}
            preventScrollReset
          >
            Completed
          </NavLink>
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
