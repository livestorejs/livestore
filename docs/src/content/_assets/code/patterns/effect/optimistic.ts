import { Atom } from '@effect-atom/atom'
import { queryDb } from '@livestore/livestore'
import { StoreTag } from './atoms.ts'
import { tables } from './schema.ts'

// Pending todos state
const pendingTodosAtom = Atom.make<Array<{ id: string; text: string; completed: boolean }>>([])

// Using unsafe API for direct access
export const todosAtom = StoreTag.makeQueryUnsafe(queryDb(tables.todos))

export const optimisticTodoAtom = Atom.make((get) => {
  const todos = get(todosAtom) // Direct array, not wrapped in Result
  const pending = get(pendingTodosAtom)

  return [...(todos || []), ...pending]
})
