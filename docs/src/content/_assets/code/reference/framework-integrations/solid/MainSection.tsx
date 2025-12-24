/** biome-ignore-all lint/a11y/noLabelWithoutControl: TODO 🫠 */
/** @jsxImportSource solid-js */
import { type Component, For } from 'solid-js'

import { visibleTodos$ } from './livestore/queries.ts'
import { events, type tables } from './livestore/schema.ts'
import { useAppStore } from './livestore/store.ts'

export const MainSection: Component = () => {
  const store = useAppStore()
  const todos = () => store()?.useQuery(visibleTodos$)
  const todoItems = () => todos()?.() ?? ([] as (typeof tables.todos.Type)[])

  const toggleTodo = ({ id, completed }: typeof tables.todos.Type) =>
    store()?.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))

  const deleteTodo = (id: string) => store()?.commit(events.todoDeleted({ id, deletedAt: new Date() }))

  return (
    <section class="main">
      <ul class="todo-list">
        <For each={todoItems()}>
          {(todo: typeof tables.todos.Type) => (
            <li>
              <div class="view">
                <input type="checkbox" class="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
                <label>{todo.text}</label>
                <button type="button" class="destroy" onClick={() => deleteTodo(todo.id)} />
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
