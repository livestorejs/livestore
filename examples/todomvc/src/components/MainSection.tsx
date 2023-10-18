import { sql } from '@livestore/livestore'
import { useLiveStoreComponent, useStore } from '@livestore/livestore/react'
import React from 'react'

import type { AppState, Todo } from '../schema.js'

export const MainSection: React.FC = () => {
  const { store } = useStore()
  const {
    queryResults: { visibleTodos },
  } = useLiveStoreComponent({
    // Define the reactive queries for this component
    queries: ({ rxSQL }) => {
      // First, we create a reactive query which defines the filter clause for the SQL query.
      // It gets all the rows from the app table, and pipes them into a transform function.
      // The result is a reactive query whose value is a string containing the filter clause.
      const filterClause$ = rxSQL<AppState>(`select * from app;`, ['app'])
        .getFirstRow()
        .pipe((appState) => (appState.filter === 'all' ? '' : `where completed = ${appState.filter === 'completed'}`))

      // Next, we create the actual query for the visible todos.
      // We create a new reactive SQL query which interpolates the filterClause.
      // Notice how we call filterClause() as a function--
      // that gets the latest value of that reactive query.
      const visibleTodos = rxSQL<Todo>((get) => sql`select * from todos ${get(filterClause$)}`, ['todos'])

      return { visibleTodos }
    },

    // For this particular component, we use a singleton key.
    componentKey: { name: 'MainSection', id: 'singleton' },
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
