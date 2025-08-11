// @ts-ignore - package will be installed by user
import { atom } from '@effect-atom/atom'
// @ts-ignore - package will be installed by user
import { Result } from '@effect-atom/atom-react'
import { queryDb } from '@livestore/livestore'
import { StoreTag } from './atoms.ts'
import { tables } from './schema.ts'

// Assume todosAtom uses StoreTag.makeQuery (non-unsafe)
export const todosAtom = StoreTag.makeQuery(queryDb(tables.todos.all()))

export const todoStatsAtom = atom((get) => {
  const todos = get(todosAtom) // Result wrapped

  return Result.map(todos, (todoList: any) => ({
    total: todoList.length,
    completed: todoList.filter((t: any) => t.completed).length,
    pending: todoList.filter((t: any) => !t.completed).length,
  }))
})
