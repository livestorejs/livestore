import { getLocalId } from '@livestore/livestore/react'
import { row } from '@livestore/livestore/solid'
import type { Accessor, Component } from 'solid-js'

import type { Todo } from '../schema/index.js'
import { mutations, tables } from '../schema/index.js'
import { store } from '../store.js'

export const Header: Component = () => {
  const localId = getLocalId()
  const newRow: Accessor<Todo> = row(tables.app, localId)

  return (
    <header class="header">
      <h1>TodoMVC</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus={true}
        value={newRow()?.text ?? ''}
        onChange={(e) => {
          store()?.mutate(
            mutations.updateNewTodoText({
              text: e.target.value,
              localId,
            }),
          )
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            store()?.mutate(
              mutations.addTodo({ id: crypto.randomUUID(), text: e.currentTarget.value }),
              mutations.updateNewTodoText({ text: '', localId }),
            )
          }
        }}
      ></input>
    </header>
  )
}
