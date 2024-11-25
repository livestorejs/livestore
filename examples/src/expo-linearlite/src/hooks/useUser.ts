import { queryDb } from '@livestore/livestore'
import { useScopedQuery } from '@livestore/react'

import { tables } from '@/livestore/schema.ts'

/**
 * @returns The first user in the users table.
 */
export const useUser = (userId?: string) =>
  useScopedQuery(() => queryDb(tables.users.query.where({ id: userId }).first()), ['useUser', userId ?? '-'])
