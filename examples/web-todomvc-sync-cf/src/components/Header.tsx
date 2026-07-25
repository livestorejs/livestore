import { type ChangeEvent, type KeyboardEvent, useCallback } from 'react'

import { uiStateQuery } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const Header = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiStateQuery(store.sessionId))

  const updatedNewTodoText = useCallback(
    (text: string) => store.commit(events.todoDraftChanged({ id: store.sessionId, text })),
    [store],
  )

  const todoCreated = useCallback(
    () =>
      store.commit(
        events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
        events.todoDraftChanged({ id: store.sessionId, text: '' }),
      ),
    [newTodoText, store],
  )

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => updatedNewTodoText(e.target.value),
    [updatedNewTodoText],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
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
        value={newTodoText}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    </header>
  )
}
