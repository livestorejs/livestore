import { type FC, useCallback } from 'react'

import { tables } from './schema.ts'
import { useAppStore } from './store.ts'

export const TodoItem: FC<{ id: string }> = ({ id }) => {
  const store = useAppStore()
  const [todo, updateTodo] = store.useClientDocument(tables.uiState, id)
  const setHelloWorld = useCallback(() => {
    updateTodo({ newTodoText: 'Hello, world!' })
  }, [updateTodo])

  return (
    <button type="button" onClick={setHelloWorld}>
      {todo.newTodoText}
    </button>
  )
}
