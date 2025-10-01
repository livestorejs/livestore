import { useStore } from '@livestore/react'
import type { FC } from 'react'

import { tables } from './schema.ts'

export const TodoItem: FC<{ id: string }> = ({ id }) => {
  const { store } = useStore()
  const [todo, updateTodo] = store.useClientDocument(tables.uiState, id)

  return (
    <button type="button" onClick={() => updateTodo({ text: 'Hello, world!' })}>
      {todo.text}
    </button>
  )
}
