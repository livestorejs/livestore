import type React from 'react'
import { uiState$ } from '../livestore/queries.ts'
import { commands, events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const Header: React.FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))

  const createTodo = () => {
    const result = store.execute(commands.createTodo({ id: crypto.randomUUID(), text: newTodoText }))
    if (result._tag === 'failed') {
      console.error('Failed to create todo:', result.error.message)
      return
    }
  }

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        value={newTodoText}
        onChange={(e) => updatedNewTodoText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            createTodo()
          }
        }}
      />
    </header>
  )
}
