import { queryDb } from '@livestore/livestore'
import type React from 'react'
import { useState } from 'react'
import { uiState$ } from '../livestore/queries.ts'
import { commands, events, tables } from '../livestore/schema.ts'
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

  const visibleTodos = store.useQuery(visibleTodos$)

  // Tracks todo IDs that had a toggle rolled back because the todo was concurrently deleted
  const [deletedConflicts, setDeletedConflicts] = useState<Set<string>>(new Set())

  const toggleTodo = async (id: string) => {
    const confirmation = await store.execute(commands.toggleTodo({ id })).confirmation
    if (confirmation._tag === 'conflict' && confirmation.error._tag === 'CannotToggleDeletedTodo') {
      setDeletedConflicts((prev) => new Set(prev).add(id))
    }
  }

  const dismissConflict = (id: string) => {
    setDeletedConflicts((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const restoreTodo = (id: string) => {
    store.commit(events.todoUndeleted({ id }))
    dismissConflict(id)
  }

  const deleteTodo = (id: string) => {
    store.commit(events.todoDeleted({ id, deletedAt: new Date() }))
  }

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
              <div style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 'bolder' }}>
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
