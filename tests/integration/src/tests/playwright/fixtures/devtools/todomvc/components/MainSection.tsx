import React from 'react'

import { queryDb } from '@livestore/livestore'

import { uiStateQuery } from '../livestore/queries.ts'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const visibleTodosQuery = (id: string) =>
  queryDb(
    (get) => {
      const { filter } = get(uiStateQuery(id))
      return tables.todos.where({
        deletedAt: null,
        completed: filter === 'all' ? undefined : filter === 'completed',
      })
    },
    { label: `visibleTodos:${id}`, deps: id },
  )

export const MainSection: React.FC = () => {
  const store = useAppStore()

  const toggleTodo = React.useCallback(
    ({ id, completed }: typeof tables.todos.Type) =>
      store.commit(completed === true ? events.todoUncompleted({ id }) : events.todoCompleted({ id })),
    [store],
  )

  const visibleTodos = store.useQuery(visibleTodosQuery(store.sessionId))

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
