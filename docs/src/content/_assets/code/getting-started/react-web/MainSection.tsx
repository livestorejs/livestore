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

  const handleToggleTodo = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const todoId = event.currentTarget.dataset.todoId
      if (todoId == null) return

      store.commit(
        event.currentTarget.checked === true
          ? events.todoCompleted({ id: todoId })
          : events.todoUncompleted({ id: todoId }),
      )
    },
    [store],
  )

  const handleDeleteTodo = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const todoId = event.currentTarget.dataset.todoId
      if (todoId == null) return

      store.commit(events.todoDeleted({ id: todoId, deletedAt: new Date() }))
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
                data-todo-id={todo.id}
                checked={todo.completed}
                onChange={handleToggleTodo}
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
