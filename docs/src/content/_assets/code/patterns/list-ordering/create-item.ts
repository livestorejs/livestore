import { generateKeyBetween } from 'fractional-indexing'

import type { Store } from '@livestore/livestore'

import { events } from './events.ts'
import { tables } from './schema.ts'

declare const store: Store

/** Create a new task at the end of the list */
export const createTaskAtEnd = (title: string) => {
  // Get the highest order value
  const highestOrder = store.query(tables.task.select('order').orderBy('order', 'desc').limit(1))[0] ?? null

  // Generate new order after the highest
  const order = generateKeyBetween(highestOrder, null)

  // Commit the event
  store.commit(events.createTask({ title, order }))

  return order
}

/** Create a new task at the beginning of the list */
export const createTaskAtStart = (title: string) => {
  // Get the lowest order value
  const lowestOrder = store.query(tables.task.select('order').orderBy('order', 'asc').limit(1))[0] ?? null

  // Generate new order before the lowest
  const order = generateKeyBetween(null, lowestOrder)

  store.commit(events.createTask({ title, order }))

  return order
}

/** Create the very first task in an empty list */
export const createFirstTask = (title: string) => {
  // When the list is empty, use a simple default value
  const order = 'a1'

  store.commit(events.createTask({ title, order }))

  return order
}
