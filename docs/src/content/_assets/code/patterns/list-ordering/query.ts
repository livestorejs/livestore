import type { Store } from '@livestore/livestore'

import { tables } from './schema.ts'

declare const store: Store

/**
 * Query tasks in their proper order
 *
 * The fractional index values maintain lexicographic ordering,
 * so we can simply order by the 'order' column.
 */
export const getOrderedTasks = () => {
  return store.query(tables.task.select().orderBy('order', 'asc'))
}

/**
 * Get the highest order value (for appending new items)
 */
export const getHighestOrder = (): string | null => {
  const order = store.query(tables.task.select('order').orderBy('order', 'desc').limit(1))[0]

  return order ?? null
}

/**
 * Get the lowest order value (for prepending new items)
 */
export const getLowestOrder = (): string | null => {
  const order = store.query(tables.task.select('order').orderBy('order', 'asc').limit(1))[0]

  return order ?? null
}
