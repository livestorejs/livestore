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
  // Tracks todo IDs that had a toggle rolled back because the todo was concurrently deleted
  const [deletedConflicts, setDeletedConflicts] = React.useState<Set<string>>(new Set())

  const dismissConflict = (id: string) => {
    setDeletedConflicts((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const restoreTodo = (id: string) => {
    store.execute(commands.undeleteTodo({ id }))
    dismissConflict(id)
  }

  const toggleTodo = async (id: string) => {
    const result = store.execute(commands.toggleTodo({ id }))
    if (result._tag === 'failed') return console.error('Failed to toggle todo:', result.error)

    const confirmation = await result.confirmation
    if (confirmation._tag === 'conflict' && confirmation.error._tag === 'CannotToggleDeletedTodo') {
      setDeletedConflicts((prev) => new Set(prev).add(id))
    }
  }

  const deleteTodo = (id: string) => {
    store.execute(commands.deleteTodo({ id, deletedAt: new Date() }))
  }

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
            {deletedConflicts.has(todo.id) && (
              <div className="conflict-message">
                <span>
                  You toggled "{todo.text}", but it was deleted by another client. Your change was rolled back.
                </span>
                <button type="button" onClick={() => restoreTodo(todo.id)}>
                  Restore
                </button>
                <button type="button" onClick={() => dismissConflict(todo.id)}>
                  Keep deleted
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
