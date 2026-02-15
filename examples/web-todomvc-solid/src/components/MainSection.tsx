import { type Component, For } from 'solid-js'

import { queryDb } from '@livestore/livestore'

import { uiState$ } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

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
  const store = useAppStore()
  const visibleTodos = store.useQuery(visibleTodos$)

  const toggleTodo = ({ id, completed }: typeof tables.todos.Type) => {
    store()?.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
  }

  return (
    <section class="main">
      <ul class="todo-list">
        <For each={visibleTodos()}>
          {(todo) => (
            <li>
              <div class="view">
                <input type="checkbox" class="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
                {/* biome-ignore lint/a11y/noLabelWithoutControl: otherwise breaks TODO MVC CSS */}
                <label>{todo.text}</label>
                <button
                  type="button"
                  class="destroy"
                  onClick={() => store()?.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))}
                />
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
