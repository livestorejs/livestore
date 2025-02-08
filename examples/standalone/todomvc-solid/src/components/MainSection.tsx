import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { type Component, Index } from 'solid-js'

import { mutations, tables, type Todo } from '../livestore/schema.js'
import { store } from '../livestore/store.jsx'

const sessionId = store?.()?.sessionId ?? 'default'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(queryDb(tables.app.query.row(sessionId)))
    return tables.todos.query.where({
      deleted: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

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
