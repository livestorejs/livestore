import { useQuery, useStore } from '@livestore/react'
import { Schema } from 'effect'
import React from 'react'

import { drizzle, queryDrizzle } from '../drizzle/queryDrizzle.js'
import * as t from '../drizzle/schema.js'
import type { Todo } from '../schema/index.js'
import { mutations, tables } from '../schema/index.js'

const filterClause$ = queryDrizzle((qb) => qb.select().from(t.app), {
  schema: tables.app.schema.pipe(Schema.Array, Schema.headOrElse()),
  map: (appState) =>
    appState.filter === 'all' ? undefined : drizzle.eq(t.todos.completed, appState.filter === 'completed'),
})

const visibleTodos$ = queryDrizzle(
  (qb, get) =>
    qb
      .select()
      .from(t.todos)
      .where(drizzle.and(get(filterClause$), drizzle.isNull(t.todos.deleted))),
  { schema: Schema.Array(tables.todos.schema) },
)

export const MainSection: React.FC = () => {
  const { store } = useStore()

  const visibleTodos = useQuery(visibleTodos$)

  // We record an event that specifies marking complete or incomplete,
  // The reason is that this better captures the user's intention
  // when the event gets synced across multiple devices--
  // If another user toggled concurrently, we shouldn't toggle it back
  const toggleTodo = (todo: Todo) =>
    store.mutate(todo.completed ? mutations.uncompleteTodo({ id: todo.id }) : mutations.completeTodo({ id: todo.id }))

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
