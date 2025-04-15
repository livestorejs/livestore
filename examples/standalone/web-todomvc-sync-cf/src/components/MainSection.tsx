import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import React from 'react'

import { app$ } from '../livestore/queries.js'
import { events, tables, type Todo } from '../livestore/schema.js'

const visibleTodos$ = queryDb(
  (get) => {
    const { filter } = get(app$)
    return tables.todos.select().where({
      deletedAt: undefined,
      completed: filter === 'all' ? undefined : filter === 'completed',
    })
  },
  { label: 'visibleTodos' },
)

export const MainSection: React.FC = () => {
  const { store } = useStore()

  const toggleTodo = React.useCallback(
    ({ id, completed }: Todo) =>
      store.commit(completed ? events.todoUncompleted({ id }) : events.todoCompleted({ id })),
    [store],
  )

  const visibleTodos = useQuery(visibleTodos$) ?? []

  return (
    <section className="main">
      <ul className="todo-list">
        {(Array.isArray(visibleTodos) ? visibleTodos : []).map((todo: Todo) => (
          <li key={todo.id}>
            <div className="view">
              <input type="checkbox" className="toggle" checked={todo.completed} onChange={() => toggleTodo(todo)} />
              <label>{todo.text}</label>
              <button
                className="destroy"
                onClick={() => store.commit(events.todoDeleted({ id: todo.id, deletedAt: new Date() }))}
              ></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
