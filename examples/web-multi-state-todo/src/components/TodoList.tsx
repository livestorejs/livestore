import { queryDb } from '@livestore/livestore'
import React from 'react'
import { events, tables } from '../livestore/schema.ts'
import type { useAppStore } from '../livestore/store.ts'

export type TodoListProps = {
  backend: 'a' | 'b'
  title: string
  store: ReturnType<typeof useAppStore>
}

export function TodoList({ backend, title, store }: TodoListProps) {
  const [newTodoText, setNewTodoText] = React.useState('')
  const [filter, setFilter] = React.useState<'all' | 'active' | 'completed'>('all')

  const todoTable = tables[backend].todos
  const todoEvents = events[backend]

  const todosQuery = React.useMemo(
    () => queryDb(todoTable.where({ deletedAt: null }).orderBy('id', 'desc'), { label: `${backend}-visibleTodos` }),
    [backend, todoTable],
  )

  const todos = store.useQuery(todosQuery)

  const visibleTodos = React.useMemo(
    () =>
      todos.filter((todo) => {
        if (filter === 'active') {
          return !todo.completed
        }

        if (filter === 'completed') {
          return todo.completed
        }

        return true
      }),
    [filter, todos],
  )

  const activeCount = React.useMemo(() => todos.filter((todo) => !todo.completed).length, [todos])
  const completedCount = React.useMemo(() => todos.filter((todo) => todo.completed).length, [todos])

  const createTodo = React.useCallback(() => {
    const text = newTodoText.trim()

    if (text.length === 0) {
      return
    }

    store.commit(todoEvents.todoCreated({ id: crypto.randomUUID(), text }))
    setNewTodoText('')
  }, [newTodoText, store, todoEvents])

  const clearCompleted = React.useCallback(() => {
    store.commit(todoEvents.todoClearedCompleted({ deletedAt: new Date() }))
  }, [store, todoEvents])

  return (
    <section className="todo-panel">
      <header className="todo-panel__header">
        <h2>{title}</h2>
        <p>
          Backend: <code>{backend}</code>
        </p>
      </header>

      <form
        className="todo-panel__create"
        onSubmit={(event) => {
          event.preventDefault()
          createTodo()
        }}
      >
        <input
          value={newTodoText}
          onChange={(event) => setNewTodoText(event.target.value)}
          placeholder={`Add todo in backend ${backend.toUpperCase()}`}
          aria-label={`New todo for backend ${backend}`}
        />
        <button type="submit">Add</button>
      </form>

      <fieldset className="todo-panel__filters">
        <legend>Filter todos for backend {backend}</legend>
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
          All
        </button>
        <button type="button" className={filter === 'active' ? 'is-active' : ''} onClick={() => setFilter('active')}>
          Active
        </button>
        <button
          type="button"
          className={filter === 'completed' ? 'is-active' : ''}
          onClick={() => setFilter('completed')}
        >
          Completed
        </button>
      </fieldset>

      <ul className="todo-panel__list">
        {visibleTodos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() =>
                  store.commit(
                    todo.completed
                      ? todoEvents.todoUncompleted({ id: todo.id })
                      : todoEvents.todoCompleted({ id: todo.id }),
                  )
                }
              />
              <span className={todo.completed ? 'is-completed' : ''}>{todo.text}</span>
            </label>
            <button
              type="button"
              onClick={() => store.commit(todoEvents.todoDeleted({ id: todo.id, deletedAt: new Date() }))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <footer className="todo-panel__footer">
        <span>{activeCount} active</span>
        <span>{completedCount} completed</span>
        <button type="button" disabled={completedCount === 0} onClick={clearCompleted}>
          Clear completed
        </button>
      </footer>
    </section>
  )
}
