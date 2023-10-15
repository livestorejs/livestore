import { useStore } from '@livestore/livestore/react'
import type { FC } from 'react'
import React from 'react'
import { v4 as uuid } from 'uuid'

import { useAppState } from '../useAppState.js'

export const Header: FC = () => {
  const { store } = useStore()
  const { newTodoText } = useAppState()

  const updateNewTodoText = (text: string) => store.applyEvent('updateNewTodoText', { text })
  const addTodo = () => {
    store.applyEvent('addTodo', { id: uuid(), text: newTodoText })
    store.applyEvent('updateNewTodoText', { text: '' })
  }

  return (
    <header className="header">
      <h1>TodoMVC</h1>
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        autoFocus={true}
        value={newTodoText}
        onChange={(e) => updateNewTodoText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            addTodo()
          }
        }}
      ></input>
    </header>
  )
}
