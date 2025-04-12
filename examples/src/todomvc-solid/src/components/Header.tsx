import { queryDb } from '@livestore/livestore'
import { query } from '@livestore/solid'
import type { Component } from 'solid-js'

import { mutations, tables } from '../livestore/schema.js'
import { store } from '../livestore/store.jsx'

const sessionId = store()?.sessionId ?? 'default'

export const Header: Component = () => {
  const newRow = query(queryDb(tables.app.get(sessionId)), {
    filter: 'all',
    id: sessionId,
    newTodoText: '',
  })

  return (
    <header class="header">
      <h1>TodoMVC</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus={true}
        value={newRow()?.newTodoText ?? ''}
        onChange={(e) => {
          store()?.commit(
            mutations.updatedNewTodoText({
              text: e.target.value,
              sessionId,
            }),
          )
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            store()?.commit(
              mutations.todoCreated({ id: crypto.randomUUID(), text: e.currentTarget.value }),
              mutations.updatedNewTodoText({ text: '', sessionId }),
            )
          }
        }}
      ></input>
    </header>
  )
}
