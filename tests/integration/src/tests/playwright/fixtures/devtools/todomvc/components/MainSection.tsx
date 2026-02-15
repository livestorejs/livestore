/** biome-ignore-all lint/a11y: testing */
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

  const deleteTodo = React.useCallback(
    (id: string) => {
      store.commit(events.todoDeleted({ id, deletedAt: new Date() }))
    },
    [store],
  )

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} onToggle={toggleTodo} onDelete={deleteTodo} />
        ))}
      </ul>
    </section>
  )
}

const TodoItem: React.FC<{
  todo: typeof tables.todos.Type
  onToggle: (todo: typeof tables.todos.Type) => void
  onDelete: (id: string) => void
}> = ({ todo, onToggle, onDelete }) => {
  const handleToggle = React.useCallback(() => onToggle(todo), [onToggle, todo])
  const handleDelete = React.useCallback(() => onDelete(todo.id), [onDelete, todo.id])

  return (
    <li>
      <div className="state">
        <input type="checkbox" className="toggle" checked={todo.completed} onChange={handleToggle} />
        <label>{todo.text}</label>
        <button className="destroy" onClick={handleDelete} />
      </div>
    </li>
  )
}
