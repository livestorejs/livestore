import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import type { Component } from 'solid-js'

import { mutations, tables } from '../livestore/schema.js'
import { store } from '../livestore/store.jsx'
import type { Filter } from '../types.js'

const sessionId = store?.()?.sessionId ?? 'default'

const incompleteCount$ = queryDb(tables.todos.query.count().where({ completed: false, deleted: null }), {
  label: 'incompleteCount',
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

  const setFilter = (filter: Filter) => store()?.commit(mutations.filterUpdated({ filter, sessionId }))

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
          store()?.commit(mutations.todoClearedCompleted({ deleted: Date.now() }))
        }}
      >
        Clear completed
      </button>
    </footer>
  )
}
