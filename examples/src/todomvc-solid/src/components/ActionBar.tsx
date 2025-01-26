import { queryDb, sql } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { Schema } from 'effect'
import type { Component } from 'solid-js'

import { mutations, tables } from '../schema/index.js'
import { store } from '../store.jsx'
import type { Filter } from '../types.js'

const sessionId = store?.()?.sessionId ?? 'default'

const incompleteCount$ = queryDb({
  query: sql`select count(*) as c from todos where completed = false and deleted is null`,
  schema: Schema.Struct({ c: Schema.Number }).pipe(Schema.pluck('c'), Schema.Array, Schema.headOrElse()),
})

export const ActionBar: Component = () => {
  const appRow = query(
    queryDb(
      tables.app.query
        .where({
          id: sessionId,
        })
        .first(),
    ),
    {
      filter: 'all',
      id: sessionId,
      newTodoText: '',
    },
  )
  const incompleteCount = query(incompleteCount$, 0)

  const setFilter = (filter: Filter) => store()?.mutate(mutations.setFilter({ filter, sessionId }))

  return (
    <footer class="footer">
      <span class="todo-count">{incompleteCount()} items left</span>
      <ul class="filters">
        <li>
          <a
            href="#/"
            class={appRow()?.filter === 'all' ? 'selected' : ''}
            onClick={() => {
              setFilter('all')
            }}
          >
            All
          </a>
        </li>
        <li>
          <a
            href="#/"
            class={appRow()?.filter === 'active' ? 'selected' : ''}
            onClick={() => {
              setFilter('active')
            }}
          >
            Active
          </a>
        </li>
        <li>
          <a
            href="#/"
            class={appRow()?.filter === 'completed' ? 'selected' : ''}
            onClick={() => {
              setFilter('completed')
            }}
          >
            Completed
          </a>
        </li>
      </ul>
      <button
        class="clear-completed"
        onClick={() => {
          store()?.mutate(mutations.clearCompleted({ deleted: Date.now() }))
        }}
      >
        Clear completed
      </button>
    </footer>
  )
}
