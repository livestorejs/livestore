import { queryDb } from '@livestore/livestore'

import { tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

/**
 * @returns The first user in the users table.
 */
export const useUser = (userId?: string) => {
  const store = useAppStore()
  return store.useQuery(
    queryDb(tables.users.where({ id: userId }).first({ behaviour: 'error' }), { deps: `useUser-${userId ?? '-'}` }),
  )
}
