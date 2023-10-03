import { useLiveStoreComponent, useStore } from '@livestore/livestore/react'
import type { FC } from 'react'
import React from 'react'

import type { Filter } from '../schema.js'
import { useAppState } from '../useAppState.js'

export const Footer: FC = () => {
  const { store } = useStore()
  const { filter } = useAppState()

  const {
    queryResults: { incompleteCount },
  } = useLiveStoreComponent({
    queries: ({ rxSQL }) => ({
      incompleteCount: rxSQL<{ incompleteCount: number }>(
        () => `select count(*) as incompleteCount from todos where completed = false;`,
        ['todos'],
      )
        .getFirstRow()
        .pipe(({ incompleteCount }) => incompleteCount),
    }),
    componentKey: { name: 'Footer', id: 'singleton' },
  })

  const setFilter = (filter: Filter) => store.applyEvent('setFilter', { filter })

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
      <button className="clear-completed" onClick={() => store.applyEvent('clearCompleted')}>
        Clear completed
      </button>
    </footer>
  )
}
