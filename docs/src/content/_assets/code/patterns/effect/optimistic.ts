// @ts-ignore - package will be installed by user
import { atom } from '@effect-atom/atom'
import { queryDb } from '@livestore/livestore'
import { StoreTag } from './atoms.ts'
import { tables } from './schema.ts'

// Pending todos state
const pendingTodosAtom = atom<Array<{ id: string; text: string; completed: boolean }>>([])

// Using unsafe API for direct access
export const todosAtom = StoreTag.makeQueryUnsafe(queryDb(tables.todos.all()))

export const optimisticTodoAtom = atom((get) => {
  const todos = get(todosAtom) // Direct array, not wrapped in Result
  const pending = get(pendingTodosAtom)

  return [...todos, ...pending]
})
