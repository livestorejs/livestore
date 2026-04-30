import { type Component, createMemo } from 'solid-js'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

export const Header: Component = () => {
  const store = useAppStore()
  const uiState = store.useQuery(uiState$)

  const updateNewTodoText = (text: string) => {
    store()?.commit(events.uiStateSet({ newTodoText: text }))
  }

  const createTodo = () => {
    const text = uiState()?.newTodoText
    if (text?.trim()) {
      store()?.commit(events.todoCreated({ id: crypto.randomUUID(), text }), events.uiStateSet({ newTodoText: '' }))
    }
  }

  const handleInput = createMemo(
    () => (event: InputEvent & { currentTarget: HTMLInputElement }) => updateNewTodoText(event.currentTarget.value),
  )

  const handleKeyDown = createMemo(
    () => (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => event.key === 'Enter' && createTodo(),
  )

  return (
    <header class="header">
      <h1>TodoMVC</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus={true}
        value={uiState()?.newTodoText ?? ''}
        onInput={handleInput()}
        onKeyDown={handleKeyDown()}
      />
    </header>
  )
}
