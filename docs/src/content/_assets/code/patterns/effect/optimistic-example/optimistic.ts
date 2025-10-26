import { Atom } from '@effect-atom/atom'
import { pendingTodosAtom, todosQueryUnsafeAtom } from '../store-setup/utils.ts'

// Combine real and pending todos for optimistic UI
export const optimisticTodoAtom = Atom.make((get) => {
  const todos = get(todosQueryUnsafeAtom) // Direct array, not wrapped in Result
  const pending = get(pendingTodosAtom)

  return [...(todos || []), ...pending]
})
