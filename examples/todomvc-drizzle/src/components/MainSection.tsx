import { useQuery, useStore } from '@livestore/livestore/react'
import React from 'react'

import { drizzle, queryDrizzle } from '../drizzle/queryDrizzle.js'
import * as t from '../drizzle/schema.js'
import type { TodoInput } from '../schema/index.js'
import { mutations } from '../schema/index.js'

const filterClause$ = queryDrizzle((qb) => qb.select().from(t.app), {
  map: ([appState]) =>
    appState!.filter === 'all' ? undefined : drizzle.eq(t.todos.completed, appState!.filter === 'completed'),
})

const visibleTodos$ = queryDrizzle((qb, get) =>
  qb
    .select()
    .from(t.todos)
    .where(drizzle.and(get(filterClause$), drizzle.isNull(t.todos.deleted))),
)

export const MainSection: React.FC = () => {
  const { store } = useStore()

  const visibleTodos = useQuery(visibleTodos$)

  // We record an event that specifies marking complete or incomplete,
  // The reason is that this better captures the user's intention
  // when the event gets synced across multiple devices--
  // If another user toggled concurrently, we shouldn't toggle it back
  const toggleTodo = (todo: TodoInput) =>
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
