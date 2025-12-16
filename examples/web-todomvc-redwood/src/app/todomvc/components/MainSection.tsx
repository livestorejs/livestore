'use client'

import { queryDb } from '@livestore/livestore'
import React from 'react'

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

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <div className="state">
              <input type="checkbox" className="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
              {/** biome-ignore lint/a11y/noLabelWithoutControl: otherwise breaks TODO MVC CSS 🙈 */}
              <label>{todo.text}</label>
              <button
                type="button"
                className="destroy"
                onClick={() => store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
