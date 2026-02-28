import { queryDb } from '@livestore/livestore'
import { useCallback } from 'react'
import { NavLink } from 'react-router-dom'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const incompleteCount$ = queryDb(tables.todos.count().where({ completed: false, deletedAt: null }), {
  label: 'incompleteCount',
})

type Filter = (typeof tables.uiState.Value)['filter']

export const Footer = () => {
  const store = useAppStore()
  const { filter } = store.useQuery(uiState$)
  const incompleteCount = store.useQuery(incompleteCount$)
  const getNavLinkClassName = useCallback(
    ({ isActive }: { isActive: boolean }) => (isActive ? 'selected' : undefined),
    [],
  )
  const handleFilterClick = useCallback(
    (nextFilter: Filter) => {
      if (filter !== nextFilter) {
        store.commit(events.uiStateSet({ filter: nextFilter }))
      }
    },
    [filter, store],
  )
  const handleAllClick = useCallback(() => handleFilterClick('all'), [handleFilterClick])
  const handleActiveClick = useCallback(() => handleFilterClick('active'), [handleFilterClick])
  const handleCompletedClick = useCallback(() => handleFilterClick('completed'), [handleFilterClick])
  const handleClearCompleted = useCallback(
    () => store.commit(events.todoClearedCompleted({ deletedAt: new Date() })),
    [store],
  )

  return (
    <footer className="footer">
      <span className="todo-count">{incompleteCount} items left</span>
      <ul className="filters">
        <li>
          <NavLink to="/" className={getNavLinkClassName} onClick={handleAllClick} preventScrollReset>
            All
          </NavLink>
        </li>
        <li>
          <NavLink to="/active" className={getNavLinkClassName} onClick={handleActiveClick} preventScrollReset>
            Active
          </NavLink>
        </li>
        <li>
          <NavLink to="/completed" className={getNavLinkClassName} onClick={handleCompletedClick} preventScrollReset>
            Completed
          </NavLink>
        </li>
      </ul>
      <button type="button" className="clear-completed" onClick={handleClearCompleted}>
        Clear completed
      </button>
    </footer>
  )
}
