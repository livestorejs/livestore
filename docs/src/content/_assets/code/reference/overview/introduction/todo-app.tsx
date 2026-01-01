// TodoApp.tsx
import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
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

export function TodoApp() {
  const store = useAppStore()

  // Reactively updates when todos change in the DB
  const todos = store.useQuery(visibleTodos$)

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
