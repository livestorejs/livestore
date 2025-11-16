import { useStore } from '@livestore/react'
import React from 'react'

import { todos$ } from '../livestore/queries.ts'
import type { TodoRow } from '../livestore/schema.ts'

export const EventsList: React.FC = () => {
  const { store } = useStore()
  const todos = store.useQuery(todos$) as ReadonlyArray<TodoRow>

  const activeTodos = React.useMemo(
    () =>
      todos
        .filter((todo) => todo.deletedAt === null)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id)),
    [todos],
  )

  const completedCount = React.useMemo(
    () => activeTodos.reduce((count, todo) => count + (todo.completed ? 1 : 0), 0),
    [activeTodos],
  )

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Todos (live state)</h2>
        <div
          style={{ display: 'flex', gap: '0.75rem', fontSize: '0.9rem' }}
          data-testid="todo-meta"
          data-total={activeTodos.length}
          data-completed={completedCount}
          data-active={activeTodos.length - completedCount}
        >
          <span data-testid="todo-count">Total: {activeTodos.length}</span>
          <span data-testid="todo-completed">Completed: {completedCount}</span>
          <span data-testid="todo-active">Active: {activeTodos.length - completedCount}</span>
        </div>
      </div>
      <ul
        style={{ maxHeight: '24rem', overflowY: 'auto', padding: 0, listStyle: 'none' }}
        data-testid="todo-list"
      >
        {activeTodos.map((todo) => (
          <li
            key={todo.id}
            data-testid="todo-item"
            data-id={todo.id}
            data-completed={todo.completed ? 'true' : 'false'}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderBottom: '1px solid #ddd',
              padding: '0.5rem 0.25rem',
              textDecoration: todo.completed ? 'line-through' : 'none',
              color: todo.completed ? '#666' : '#111',
            }}
          >
            <span>{todo.id}</span>
            <span>{todo.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
