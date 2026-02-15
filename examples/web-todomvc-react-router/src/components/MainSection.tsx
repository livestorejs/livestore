import React from 'react'

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

export const MainSection: React.FC = () => {
  const store = useAppStore()

  const toggleTodo = React.useCallback(
    ({ id, completed }: typeof tables.todos.Type) =>
      store.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id })),
    [store],
  )

  const visibleTodos = store.useQuery(visibleTodos$)

  const handleTodoToggle = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const id = e.currentTarget.dataset.todoId
      if (!id) return
      const todo = visibleTodos.find((item) => item.id === id)
      if (todo) {
        toggleTodo(todo)
      }
    },
    [toggleTodo, visibleTodos],
  )

  const handleTodoDelete = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const id = e.currentTarget.dataset.todoId
      if (!id) return
      store.commit(events.todoDeleted({ id, deletedAt: new Date() }))
    },
    [store],
  )

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <div className="state">
              <input
                type="checkbox"
                className="toggle"
                checked={todo.completed}
                data-todo-id={todo.id}
                onChange={handleTodoToggle}
              />
              {/** biome-ignore lint/a11y/noLabelWithoutControl: otherwise breaks TODO MVC CSS 🙈 */}
              <label>{todo.text}</label>
              <button
                type="button"
                className="destroy"
                data-todo-id={todo.id}
                onClick={handleTodoDelete}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
