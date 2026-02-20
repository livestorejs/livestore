/** biome-ignore-all lint/a11y/noLabelWithoutControl: TODO 🫠 */
/** @jsxImportSource solid-js */
import { type Component, createMemo, For } from 'solid-js'

import { visibleTodos$ } from './livestore/queries.ts'
import { events, type tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'

export const MainSection: Component = () => {
  const store = useAppStore()
  const todos = store.useQuery(visibleTodos$)
  const todoItems = () => todos() ?? ([] as (typeof tables.todos.Type)[])

  const handleToggleTodo = createMemo(() => (event: Event & { currentTarget: HTMLInputElement }) => {
    const id = event.currentTarget.dataset.todoId
    const completed = event.currentTarget.dataset.completed
    if (id !== undefined && completed !== undefined) {
      store()?.commit(completed === 'true' ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
    }
  })

  const handleDeleteTodo = createMemo(() => (event: Event & { currentTarget: HTMLButtonElement }) => {
    const id = event.currentTarget.dataset.todoId
    if (id !== undefined) {
      store()?.commit(events.todoDeleted({ id, deletedAt: new Date() }))
    }
  })

  return (
    <section class="main">
      <ul class="todo-list">
        <For each={todoItems()}>
          {(todo: typeof tables.todos.Type) => (
            <li>
              <div class="view">
                <input
                  type="checkbox"
                  class="toggle"
                  checked={todo.completed}
                  data-todo-id={todo.id}
                  data-completed={String(todo.completed)}
                  onChange={handleToggleTodo()}
                />
                <label>{todo.text}</label>
                <button type="button" class="destroy" data-todo-id={todo.id} onClick={handleDeleteTodo()} />
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
