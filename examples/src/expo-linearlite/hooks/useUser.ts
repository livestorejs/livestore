import { useScopedQuery } from '@livestore/react';
import { queryDb } from '@livestore/livestore';
import { tables } from '@/livestore/schema';

/**
 * @returns The first user in the users table.
 */
export const useUser = (userId?: string)  => useScopedQuery(() => queryDb(tables.users.query.where({ id: userId }).first()), [userId ?? '-'])
