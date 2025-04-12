import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { type Component, Index } from 'solid-js'

import { mutations, tables, type Todo } from '../livestore/schema.js'
import { store } from '../livestore/store.jsx'

const sessionId = store?.()?.sessionId ?? 'default'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(queryDb(tables.app.get(sessionId)))
    return tables.todos.query.where({
      deleted: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

export const MainSection: Component = () => {
  const toggleTodo = ({ id, completed }: Todo) => {
    store()?.commit(completed ? mutations.todoUncompleted({ id }) : mutations.todoCompleted({ id }))
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
                    store()?.commit(mutations.todoDeleted({ id: todo().id, deleted: new Date() }))
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
