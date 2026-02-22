/** biome-ignore-all lint/a11y/noLabelWithoutControl: TODO 🫠 */
/** @jsxImportSource solid-js */
import { type Component, For } from 'solid-js'

import { visibleTodos$ } from './livestore/queries.ts'
import { events, type tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'

let currentStore: ReturnType<typeof useAppStore> | undefined

const handleToggle = (event: Event & { currentTarget: HTMLInputElement }) => {
  const store = currentStore?.()
  if (store === undefined) return
  const id = event.currentTarget.dataset.todoId
  const completed = event.currentTarget.dataset.todoCompleted
  if (id === undefined || completed === undefined) return
  store.commit(completed === 'true' ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
}

const handleDelete = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
  const store = currentStore?.()
  if (store === undefined) return
  const id = event.currentTarget.dataset.todoId
  if (id === undefined) return
  store.commit(events.todoDeleted({ id, deletedAt: new Date() }))
}

export const MainSection: Component = () => {
  const store = useAppStore()
  currentStore = store
  const todos = store.useQuery(visibleTodos$)
  const todoItems = () => todos() ?? ([] as (typeof tables.todos.Type)[])

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
                  data-todo-completed={todo.completed === true ? 'true' : 'false'}
                  onChange={handleToggle}
                />
                <label>{todo.text}</label>
                <button type="button" class="destroy" data-todo-id={todo.id} onClick={handleDelete} />
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
