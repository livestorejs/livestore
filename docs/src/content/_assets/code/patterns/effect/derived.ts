import { Atom } from '@effect-atom/atom'
import { Result } from '@effect-atom/atom-react'
import { queryDb } from '@livestore/livestore'
import { StoreTag } from './atoms.ts'
import { tables } from './schema.ts'

// Assume todosAtom uses StoreTag.makeQuery (non-unsafe)
export const todosAtom = StoreTag.makeQuery(queryDb(tables.todos))

export const todoStatsAtom = Atom.make((get) => {
  const todos = get(todosAtom) // Result wrapped

  return Result.map(todos, (todoList: any) => ({
    total: todoList.length,
    completed: todoList.filter((t: any) => t.completed).length,
    pending: todoList.filter((t: any) => !t.completed).length,
  }))
})
