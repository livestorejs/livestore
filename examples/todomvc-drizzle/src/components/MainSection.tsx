import { useStore } from '@livestore/livestore/react'
import type { FC } from 'react'
import React from 'react'

import type { AppState, Todo } from '../schema'
import { useDrizzle, drizzle } from '../drizzle/useDrizzle'
import { app, todos } from '../drizzle/schema'

export const MainSection: FC = () => {
  const { store } = useStore()

  const {
    queryResults: { visibleTodos },
  } = useDrizzle({
    componentKey: { name: 'MainSection', id: 'singleton' },
    queries: ({ rxSQL, qb }) => {
      const filterClause = rxSQL<AppState>(() => qb.select().from(app), ['app'])
        .getFirstRow()
        .pipe((appState) => {
          if (appState.filter === 'all') {
            return { filter: undefined }
          } else {
            return { filter: drizzle.eq(todos.completed, appState.filter === 'completed') }
          }
        })

      const visibleTodos = rxSQL<Todo>(
        (get) => {
          const { filter } = get(filterClause.results$)

          return qb.select().from(todos).where(filter)
        },
        ['todos'],
      )

      return { visibleTodos }
    },
  })

  // We record an event that specifies marking complete or incomplete,
  // The reason is that this better captures the user's intention
  // when the event gets synced across multiple devices--
  // If another user toggled concurrently, we shouldn't toggle it back
  const toggleTodo = (todo: Todo) => {
    if (todo.completed) {
      store.applyEvent('uncompleteTodo', { id: todo.id })
    } else {
      store.applyEvent('completeTodo', { id: todo.id })
    }
  }

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo: Todo) => (
          <li key={todo.id}>
            <div className="view">
              <input type="checkbox" className="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
              <label>{todo.text}</label>
              <button className="destroy" onClick={() => store.applyEvent('deleteTodo', { id: todo.id })}></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
