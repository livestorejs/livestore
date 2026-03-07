import { useCallback, type ChangeEvent, type KeyboardEvent } from 'react'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const Header = () => {
  const store = useAppStore()
  const { newTodoText } = store.useQuery(uiState$)

  const updatedNewTodoText = useCallback((text: string) => store.commit(events.uiStateSet({ newTodoText: text })), [store])

  const todoCreated = useCallback(
    () =>
      store.commit(
        events.todoCreated({ id: crypto.randomUUID(), text: newTodoText }),
        events.uiStateSet({ newTodoText: '' }),
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
