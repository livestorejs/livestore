/** biome-ignore-all lint/a11y: testing */
import React from 'react'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const Header: React.FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = React.useCallback(
    (text: string) => store.commit(events.uiStateSet({ newTodoText: text })),
    [store],
  )

  const todoCreated = React.useCallback(
    () =>
      store.commit(
        events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
        events.uiStateSet({ newTodoText: '' }),
      ),
    [store, newTodoText],
  )

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatedNewTodoText(event.target.value)
    },
    [updatedNewTodoText],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        todoCreated()
      }
    },
    [todoCreated],
  )

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        autoFocus={true}
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    </header>
  )
}
