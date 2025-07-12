import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import { type Component, Index } from 'solid-js'

import { uiState$ } from '../livestore/queries.js'
import { events, tables } from '../livestore/schema.js'
import { store } from '../livestore/store.js'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(uiState$)
    return tables.todos.where({
      deletedAt: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

export const MainSection: Component = () => {
  const toggleTodo = ({ id, completed }: typeof tables.todos.Type) => {
    store()?.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
  }

  const visibleTodos = query(visibleTodos$, [])

  return (
    <section class="main">
      <ul class="todo-list">
        <Index each={visibleTodos() || []}>
          {(todo) => (
            <li onClick={() => toggleTodo(todo())}>
              <div class="view">
                <label>
                  <input title="check " type="checkbox" class="toggle" checked={todo().completed} />
                  {todo().text}
                </label>
                <button
                  type="button"
                  title="button"
                  class="destroy"
                  onClick={(e) => {
                    e.stopPropagation()
                    store()?.commit(events.todoDeleted({ id: todo().id, deletedAt: new Date() }))
                  }}
                />
              </div>
            </li>
          )}
        </Index>
      </ul>
    </section>
  )
}
