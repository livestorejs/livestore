import { useQuery, useStore } from '@livestore/react'
import React from 'react'

import { app$ } from '../livestore/queries.js'
import { mutations } from '../livestore/schema.js'

export const Header: React.FC = () => {
  const { store } = useStore()
  const sessionId = store.sessionId
  const { newTodoText } = useQuery(app$)

  const updatedNewTodoText = (text: string) => store.mutate(mutations.updatedNewTodoText({ text, sessionId }))
  const todoCreated = () =>
    store.mutate(
      mutations.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      mutations.updatedNewTodoText({ text: '', sessionId }),
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
