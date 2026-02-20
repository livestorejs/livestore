import type React from 'react'
import { useCallback } from 'react'

import { queryDb } from '@livestore/livestore'

import { events, tables } from './livestore/schema.ts'
import { useAppStore } from './store.ts'

const uiState$ = queryDb(tables.uiState.get(), { label: 'uiState' })

export const Header: React.FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updateNewTodoText = useCallback(
    (text: string) => {
      store.commit(events.uiStateSet({ newTodoText: text }))
    },
    [store],
  )

  const createTodo = useCallback(() => {
    store.commit(
      events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
      events.uiStateSet({ newTodoText: '' }),
    )
  }, [newTodoText, store])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateNewTodoText(event.target.value)
    },
    [updateNewTodoText],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        createTodo()
      }
    },
    [createTodo],
  )

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    </header>
  )
}
