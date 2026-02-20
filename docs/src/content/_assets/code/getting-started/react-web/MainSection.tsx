import React from 'react'

import { queryDb } from '@livestore/livestore'

import { events, tables } from './livestore/schema.ts'
import { useAppStore } from './store.ts'

const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })

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
    (id: string, completed: boolean) => {
      store.commit(completed === true ? events.todoUncompleted({ id }) : events.todoCompleted({ id }))
    },
    [store],
  )

  const handleToggleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { todoId, completed } = event.currentTarget.dataset
      if (todoId !== undefined && completed !== undefined) {
        toggleTodo(todoId, completed === 'true')
      }
    },
    [toggleTodo],
  )

  const handleDeleteTodo = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.todoId
      if (id !== undefined) {
        store.commit(events.todoDeleted({ id, deletedAt: new Date() }))
      }
    },
    [store],
  )

  const visibleTodos = store.useQuery(visibleTodos$)

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <div className="view">
              <input
                type="checkbox"
                className="toggle"
                id={`todo-${todo.id}`}
                checked={todo.completed}
                data-todo-id={todo.id}
                data-completed={String(todo.completed)}
                onChange={handleToggleChange}
              />
              <label htmlFor={`todo-${todo.id}`}>{todo.text}</label>
              <button type="button" className="destroy" data-todo-id={todo.id} onClick={handleDeleteTodo} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
