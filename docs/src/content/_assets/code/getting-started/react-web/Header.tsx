import type React from 'react'
import { useCallback } from 'react'

import { queryDb } from '@livestore/livestore'

import { events, tables } from './livestore/schema.ts'
import { useAppStore } from './store.ts'

const uiStateQuery = (id: string) =>
  queryDb(
    tables.uiState.where({ id }).first({
      behaviour: 'fallback',
      fallback: () => ({ id, newTodoText: '', filter: 'all' as const }),
    }),
    { label: `uiState:${id}`, deps: id },
  )

export const Header: React.FC = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiStateQuery(store.sessionId))

  const updateNewTodoText = useCallback(
    (text: string) => store.commit(events.todoDraftChanged({ id: store.sessionId, text })),
    [store],
  )

  const createTodo = useCallback(
    () =>
      store.commit(
        events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
        events.todoDraftChanged({ id: store.sessionId, text: '' }),
      ),
    [newTodoText, store],
  )

  const handleNewTodoTextChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateNewTodoText(event.target.value)
    },
    [updateNewTodoText],
  )

  const handleInputKeyDown = useCallback(
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
        onChange={handleNewTodoTextChange}
        onKeyDown={handleInputKeyDown}
      />
    </header>
  )
}
