import { Atom } from '@effect-atom/atom'
import { Result } from '@effect-atom/atom-react'
import { todosQueryAtom } from '../store-setup/utils.ts'

// Derive statistics from todos
export const todoStatsAtom = Atom.make((get) => {
  const todos = get(todosQueryAtom) // Result wrapped

  return Result.map(todos, (todoList) => ({
    total: todoList.length,
    completed: todoList.filter((t) => t.completed).length,
    pending: todoList.filter((t) => !t.completed).length,
  }))
})
