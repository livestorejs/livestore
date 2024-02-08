import { Schema } from '@effect/schema'
import { querySQL } from '@livestore/livestore'
import { useQuery, useRow, useStore } from '@livestore/livestore/react'
import React from 'react'

import { mutations, tables } from '../schema/index.js'
import type { Filter } from '../types.js'

const incompleteCount$ = querySQL(`select count(*) as c from todos where completed = false;`, {
  map: Schema.pluck(Schema.struct({ c: Schema.number }), 'c').pipe(Schema.array, Schema.headOr),
})

export const Footer: React.FC = () => {
  const { store } = useStore()
  const [{ filter }] = useRow(tables.app)
  const incompleteCount = useQuery(incompleteCount$)

  const setFilter = (filter: Filter) => store.mutate(mutations.setFilter({ filter }))

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
      <button className="clear-completed" onClick={() => store.mutate(mutations.clearCompleted())}>
        Clear completed
      </button>
    </footer>
  )
}
