/** biome-ignore-all lint/a11y: testing */
import type React from 'react'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const Header: React.FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))

  const todoCreated = () =>
    store.commit(
      events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      events.uiStateSet({ newTodoText: '' }),
    )

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        autoFocus={true}
        value={newTodoText}
        onChange={(e) => updatedNewTodoText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            todoCreated()
          }
        }}
      />
    </header>
  )
}
