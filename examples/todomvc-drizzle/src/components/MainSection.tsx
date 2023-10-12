import { useStore } from '@livestore/livestore/react'
import type { FC } from 'react'
import React from 'react'

import * as t from '../drizzle/schema.js'
import { drizzle, useDrizzle } from '../drizzle/useDrizzle.js'
import type { AppState, Todo } from '../schema.js'

export const MainSection: FC = () => {
  const { store } = useStore()

  const {
    queryResults: { visibleTodos },
  } = useDrizzle({
    componentKey: { name: 'MainSection', id: 'singleton' },
    queries: ({ rxSQL, qb }) => {
      const filterClause = rxSQL<AppState>(() => qb.select().from(t.app), ['app'])
        .getFirstRow()
        .pipe((appState) =>
          // TODO get rid of `filter` wrapper
          appState.filter === 'all'
            ? { filter: undefined }
            : { filter: drizzle.eq(t.todos.completed, appState.filter === 'completed') },
        )

      const visibleTodos = rxSQL<Todo>(
        (get) => {
          const { filter } = get(filterClause.results$)

          return qb.select().from(t.todos).where(filter)
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
