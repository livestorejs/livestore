import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'

import { tables } from '@/livestore/schema.ts'

/**
 * @returns The first user in the users table.
 */
export const useUser = (userId?: string) =>
  useQuery(
    queryDb(tables.users.where({ id: userId }).first({ behaviour: 'error' }), { deps: `useUser-${userId ?? '-'}` }),
  )
