import type { Store } from '@livestore/livestore'
import { generateKeyBetween } from 'fractional-indexing'

import { events } from './events.ts'
import { tables } from './schema.ts'

declare const store: Store

/**
 * Reorder a task by moving it between two other tasks
 *
 * @param taskId - The task to reorder
 * @param beforeOrder - The order value of the task that will be before this one (null if moving to end)
 * @param afterOrder - The order value of the task that will be after this one (null if moving to start)
 */
export const reorderTask = (taskId: number, beforeOrder: string | null, afterOrder: string | null) => {
  // Generate a new fractional index between the two positions
  const newOrder = generateKeyBetween(beforeOrder, afterOrder)

  // Commit the update event
  store.commit(events.updateTaskOrder({ id: taskId, order: newOrder }))

  return newOrder
}

/**
 * Handle drag-and-drop reordering
 *
 * This is a more complete example showing how to handle drag-and-drop
 * with proper boundary checks.
 */
export const handleDragDrop = (draggedTaskId: number, targetTaskId: number, dropPosition: 'before' | 'after') => {
  const before = dropPosition === 'before'

  // Get the target task's order
  const targetOrder = store.query(tables.task.select('order').where({ id: targetTaskId }).first({ behaviour: 'error' }))

  // Find the nearest task in the drop direction
  const nearestOrder =
    store.query(
      tables.task
        .select('order')
        .where({
          order: { op: before ? '>' : '<', value: targetOrder },
        })
        .orderBy('order', before ? 'asc' : 'desc')
        .limit(1),
    )[0] ?? null

  // Generate new order between target and nearest
  const newOrder = generateKeyBetween(before ? targetOrder : nearestOrder, before ? nearestOrder : targetOrder)

  // Commit the update
  store.commit(events.updateTaskOrder({ id: draggedTaskId, order: newOrder }))

  return newOrder
}
