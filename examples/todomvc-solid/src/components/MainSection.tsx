import { Schema } from '@effect/schema'
import { querySQL, rowQuery, sql } from '@livestore/livestore'
import { getLocalId } from '@livestore/livestore/react'
import { query } from '@livestore/livestore/solid'
import { type Component, Index } from 'solid-js'

import { mutations, tables, type Todo } from '../schema/index.js'
import { store } from '../store.jsx'

const filterClause$ = rowQuery(tables.app, getLocalId(), {
  map: ({ filter }) => `where ${filter === 'all' ? '' : `completed = ${filter === 'completed'} and `}deleted is null`,
  label: 'filterClause',
})

const visibleTodos$ = querySQL((get) => sql`select * from todos ${get(filterClause$)}`, {
  schema: Schema.Array(tables.todos.schema),
  label: 'visibleTodos',
})

export const MainSection: Component = () => {
  const toggleTodo = ({ id, completed }: Todo) => {
    store()?.mutate(completed ? mutations.uncompleteTodo({ id }) : mutations.completeTodo({ id }))
  }

  const visibleTodos = query(visibleTodos$, [])

  return (
    <section class="main">
      <ul class="todo-list">
        <Index each={visibleTodos() || []}>
          {(todo) => (
            <li onClick={() => toggleTodo(todo())}>
              <div class="view">
                <input title="check " type="checkbox" class="toggle" checked={todo().completed} />
                <label>{todo().text}</label>
                <button
                  title="button"
                  class="destroy"
                  onClick={(e) => {
                    e.stopPropagation()
                    store()?.mutate(mutations.deleteTodo({ id: todo().id, deleted: Date.now() }))
                  }}
                ></button>
              </div>
            </li>
          )}
        </Index>
      </ul>
    </section>
  )
}
