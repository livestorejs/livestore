// TodoApp.tsx
import { queryDb } from '@livestore/livestore'
import { useQuery, useStore } from '@livestore/react'
import { events, tables } from './schema.ts'

// Define a reactive query
const visibleTodos$ = queryDb(() => tables.todos, {
  label: 'visibleTodos',
})

export function TodoApp() {
  const { store } = useStore()

  // Reactively updates when todos change in the DB
  const todos = useQuery(visibleTodos$)

  const addTodo = (text: string) => {
    // Commit an event to the store
    store.commit(
      events.todoCreated({
        id: crypto.randomUUID(),
        text,
      }),
    )
  }

  const completeTodo = (id: string) => {
    // Commit an event to the store
    store.commit(events.todoCompleted({ id }))
  }

  return (
    <div>
      <button type="button" onClick={() => addTodo('New todo')}>
        Add
      </button>
      {todos.map((todo) => (
        <button key={todo.id} type="button" onClick={() => completeTodo(todo.id)}>
          {todo.completed ? '✓' : '○'} {todo.text}
        </button>
      ))}
    </div>
  )
}
