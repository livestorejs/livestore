import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import type React from 'react'

import { events, tables } from './livestore/schema.ts'

const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })

export const Header: React.FC = () => {
  const { store } = useStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updateNewTodoText = (text: string) => store.commit(events.uiStateSet({ newTodoText: text }))

  const createTodo = () =>
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
        value={newTodoText}
        onChange={(e) => updateNewTodoText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            createTodo()
          }
        }}
      />
    </header>
  )
}
