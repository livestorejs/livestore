import type { FC } from 'react'

import { tables } from './schema.ts'
import { useAppStore } from './store.ts'

export const TodoItem: FC<{ id: string }> = ({ id }) => {
  const store = useAppStore()
  const [todo, updateTodo] = store.useClientDocument(tables.uiState, id)

  return (
    <button type="button" onClick={() => updateTodo({ text: 'Hello, world!' })}>
      {todo.text}
    </button>
  )
}
