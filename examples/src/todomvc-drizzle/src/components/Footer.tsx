import { useQuery, useRow, useStore } from '@livestore/react'
import { Schema } from 'effect'
import React from 'react'

import { drizzle, queryDrizzle } from '../drizzle/queryDrizzle.js'
import * as t from '../drizzle/schema.js'
import { mutations, tables } from '../schema/index.js'
import type { Filter } from '../types.js'

const incompleteCount$ = queryDrizzle(
  (qb) =>
    qb
      .select({ c: drizzle.sql<number>`count(*) as c` })
      .from(t.todos)
      .where(drizzle.and(drizzle.eq(t.todos.completed, false), drizzle.isNull(t.todos.deleted))),
  {
    schema: Schema.Struct({ c: Schema.Number }).pipe(Schema.pluck('c'), Schema.Array, Schema.headOrElse()),
  },
)

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
      <button
        className="clear-completed"
        onClick={() => store.mutate(mutations.clearCompleted({ deleted: Date.now() }))}
      >
        Clear completed
      </button>
    </footer>
  )
}
