import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import React from 'react'

import { app$ } from '../livestore/queries.js'
import { mutations, tables, type Todo } from '../livestore/schema.js'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(app$)
    return tables.todos.query.where({
      deleted: null,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

export const MainSection: React.FC = () => {
  const { store } = useStore()

  const toggleTodo = React.useCallback(
    ({ id, completed }: Todo) =>
      store.mutate(completed ? mutations.uncompleteTodo({ id }) : mutations.completeTodo({ id })),
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
                onClick={() => store.mutate(mutations.deleteTodo({ id: todo.id, deleted: new Date() }))}
              ></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
