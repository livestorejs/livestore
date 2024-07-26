import { Schema } from '@effect/schema'
import { querySQL, sql } from '@livestore/livestore'
import { getLocalId, useQuery, useStore } from '@livestore/livestore/react'
import React from 'react'

import { mutations, tables, type Todo } from '../schema/index.js'

// Define the reactive queries for this component

// First, we create a reactive query which defines the filter clause for the SQL query.
// It gets all the rows from the app table, and pipes them into a transform function.
// The result is a reactive query whose value is a string containing the filter clause.
// TODO make sure row exists before querying
const filterClause$ = querySQL(sql`select filter from app where id = '${getLocalId()}'`, {
  map: (rows) => {
    const { filter } = Schema.decodeSync(
      Schema.Array(tables.app.schema.pipe(Schema.pick('filter'))).pipe(Schema.headOrElse()),
    )(rows)
    return `where ${filter === 'all' ? '' : `completed = ${filter === 'completed'} and `}deleted is null`
  },
})

// Next, we create the actual query for the visible todos.
// We create a new reactive SQL query which interpolates the filterClause.
// Notice how we call filterClause() as a function--
// that gets the latest value of that reactive query.
const visibleTodos$ = querySQL((get) => sql`select * from todos ${get(filterClause$)}`, {
  map: Schema.Array(tables.todos.schema),
})

export const MainSection: React.FC = () => {
  const { store } = useStore()

  // We record an event that specifies marking complete or incomplete,
  // The reason is that this better captures the user's intention
  // when the event gets synced across multiple devices--
  // If another user toggled concurrently, we shouldn't toggle it back
  const toggleTodo = React.useCallback(
    (todo: Todo) =>
      store.mutate(
        todo.completed ? mutations.uncompleteTodo({ id: todo.id }) : mutations.completeTodo({ id: todo.id }),
      ),
    [store],
  )

  const visibleTodos = useQuery(visibleTodos$)

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <div className="view">
              <input type="checkbox" className="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
              <label>{todo.text}</label>
              <button
                className="destroy"
                onClick={() => store.mutate(mutations.deleteTodo({ id: todo.id, deleted: Date.now() }))}
              ></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
