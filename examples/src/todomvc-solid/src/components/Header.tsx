import { row } from '@livestore/solid'
import type { Accessor, Component } from 'solid-js'

import type { Todo } from '../schema/index.js'
import { mutations, tables } from '../schema/index.js'
import { store } from '../store.js'

const sessionId = store()?.sessionId ??'default'; 

export const Header: Component = () => {
  const newRow = row(tables.app, sessionId)

  return (
    <header class="header">
      <h1>TodoMVC</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus={true}
        value={newRow()?.newTodoText ?? ''}
        onChange={(e) => {
          store()?.mutate(
            mutations.updateNewTodoText({
              text: e.target.value,
              sessionId,
            }),
          )
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            store()?.mutate(
              mutations.addTodo({ id: crypto.randomUUID(), text: e.currentTarget.value }),
              mutations.updateNewTodoText({ text: '', sessionId }),
            )
          }
        }}
      ></input>
    </header>
  )
}
