import { useStore } from '@livestore/react'
import React from 'react'

import { uiState$ } from '../livestore/queries.js'
import { events } from '../livestore/schema.js'

export const Header: React.FC = () => {
  const { store } = useStore()
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
      ></input>
    </header>
  )
}
