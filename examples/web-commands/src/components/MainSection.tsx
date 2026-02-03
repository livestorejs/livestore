import { queryDb } from '@livestore/livestore'
import React from 'react'
import { uiState$ } from '../livestore/queries.ts'
import { commands, tables } from '../livestore/schema.ts'
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
    (id: string) => {
      const result = store.execute(commands.toggleTodo({ id }))
      if (result._tag === 'failed') {
        console.error('Failed to toggle todo:', result.error.message)
      }
    },
    [store],
  )

  const deleteTodo = React.useCallback(
    (id: string) => {
      const result = store.execute(commands.deleteTodo({ id, deletedAt: new Date() }))
      if (result._tag === 'failed') {
        console.error('Failed to delete todo:', result.error.message)
      }
    },
    [store],
  )

  const visibleTodos = store.useQuery(visibleTodos$)

  return (
    <section className="main">
      <ul className="todo-list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <div className="state">
              <input type="checkbox" className="toggle" checked={todo.completed} onChange={() => toggleTodo(todo.id)} />
              {/** biome-ignore lint/a11y/noLabelWithoutControl: otherwise breaks TODO MVC CSS 🙈 */}
              <label>{todo.text}</label>
              <button type="button" className="destroy" onClick={() => deleteTodo(todo.id)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
