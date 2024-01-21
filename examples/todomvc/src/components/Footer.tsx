import { Schema } from '@effect/schema'
import { querySQL } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/livestore/react'
import React from 'react'

import type { Filter } from '../schema.js'
import { useAppState } from '../useAppState.js'

const incompleteCount$ = querySQL(`select count(*) as c from todos where completed = false;`, {
  map: Schema.pluck(Schema.struct({ c: Schema.number }), 'c').pipe(Schema.array, Schema.headOr),
})

export const Footer: React.FC = () => {
  const { store } = useStore()
  const { filter } = useAppState()
  const incompleteCount = useQuery(incompleteCount$)

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
