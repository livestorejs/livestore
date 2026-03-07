import { queryDb } from '@livestore/livestore'
import { type Component, createMemo, For } from 'solid-js'

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

  const handleToggleChange = createMemo(() => (event: Event & { currentTarget: HTMLInputElement }) => {
    const id = event.currentTarget.dataset.todoId
    if (!id) return
    const todo = visibleTodos()?.find((item) => item.id === id)
    if (todo) {
      toggleTodo(todo)
    }
  })

  const handleDeleteClick = createMemo(() => (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const id = event.currentTarget.dataset.todoId
    if (!id) return
    store()?.commit(events.todoDeleted({ id, deletedAt: new Date() }))
  })

  return (
    <section class="main">
      <ul class="todo-list">
        <For each={visibleTodos()}>
          {(todo) => (
            <li>
              <div class="view">
                <input
                  type="checkbox"
                  class="toggle"
                  checked={todo.completed}
                  data-todo-id={todo.id}
                  onChange={handleToggleChange()}
                />
                {/* biome-ignore lint/a11y/noLabelWithoutControl: otherwise breaks TODO MVC CSS */}
                <label>{todo.text}</label>
                <button type="button" class="destroy" data-todo-id={todo.id} onClick={handleDeleteClick()} />
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
