import { Atom } from '@effect-atom/atom'
import { queryDb } from '@livestore/livestore'
import { StoreTag } from './atoms.ts'
import { tables } from './schema.ts'

// Common query atoms that can be reused
export const todosQueryAtom = StoreTag.makeQuery(queryDb(tables.todos))
export const todosQueryUnsafeAtom = StoreTag.makeQueryUnsafe(queryDb(tables.todos))
export const usersQueryAtom = StoreTag.makeQuery(queryDb(tables.users))
export const productsQueryAtom = StoreTag.makeQuery(queryDb(tables.products))

// Common types for optimistic updates
export type PendingTodo = { id: string; text: string; completed: boolean }
export type PendingUser = { id: string; name: string; email: string }

// Common pending state atoms
export const pendingTodosAtom = Atom.make<PendingTodo[]>([])
export const pendingUsersAtom = Atom.make<PendingUser[]>([])
