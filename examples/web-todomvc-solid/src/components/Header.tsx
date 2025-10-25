import { query } from '@livestore/solid'
import type { Component } from 'solid-js'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { store } from '../livestore/store.ts'

export const Header: Component = () => {
  const newRow = query(uiState$, { filter: 'all', newTodoText: '' })

  return (
    <header class="header">
      <h1>TodoMVC</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus={true}
        value={newRow()?.newTodoText ?? ''}
        onChange={(e) => {
          store()?.commit(events.uiStateSet({ newTodoText: e.target.value }))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            store()?.commit(
              events.todoCreated({ id: crypto.randomUUID(), text: e.currentTarget.value }),
              events.uiStateSet({ newTodoText: '' }),
            )
          }
        }}
      />
    </header>
  )
}
