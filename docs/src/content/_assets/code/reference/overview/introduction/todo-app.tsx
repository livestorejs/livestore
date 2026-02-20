import type React from 'react'
import { useCallback } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

// TodoApp.tsx
import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'

import { events, schema, tables } from './schema.ts'

const adapter = makeInMemoryAdapter()

const useAppStore = () =>
  useStore({
    storeId: 'my-app',
    schema,
    adapter,
    batchUpdates,
  })

// Define a reactive query
const visibleTodos$ = queryDb(() => tables.todos, {
  label: 'visibleTodos',
})

export const TodoApp = () => {
  const store = useAppStore()

  // Reactively updates when todos change in the DB
  const todos = store.useQuery(visibleTodos$)

  const addTodo = useCallback(
    (text: string) => {
      // Commit an event to the store
      store.commit(
        events.todoCreated({
          id: crypto.randomUUID(),
          text,
        }),
      )
    },
    [store],
  )

  const completeTodo = useCallback(
    (id: string) => {
      // Commit an event to the store
      store.commit(events.todoCompleted({ id }))
    },
    [store],
  )

  const handleAddTodo = useCallback(() => {
    addTodo('New todo')
  }, [addTodo])

  const handleCompleteTodo = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.todoId
      if (id !== undefined) {
        completeTodo(id)
      }
    },
    [completeTodo],
  )

  return (
    <div>
      <button type="button" onClick={handleAddTodo}>
        Add
      </button>
      {todos.map((todo) => (
        <button key={todo.id} type="button" data-todo-id={todo.id} onClick={handleCompleteTodo}>
          {todo.completed === true ? '✓' : '○'} {todo.text}
        </button>
      ))}
    </div>
  )
}
