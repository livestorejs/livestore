import { makeSchema, State } from '@livestore/livestore'

// Import both aggregates
import { labelEvents, labelMaterializers, labelTables } from './label-schema.ts'
import { threadEvents, threadMaterializers, threadTables } from './thread-schema.ts'

/**
 * Combined Email Client Schema
 *
 * This combines two separate aggregates following DDD principles:
 * 1. Label Management Aggregate - handles system labels and counts
 * 2. Thread Aggregate - handles email threads, messages, and thread-label associations
 *
 * The aggregates communicate through cross-aggregate events:
 * - When ThreadLabelApplied/Removed events occur, they trigger LabelMessageCountUpdated events
 */

// Combine all tables from both aggregates
export const tables = {
  // Label Management Aggregate tables
  ...labelTables,

  // Thread Aggregate tables
  ...threadTables,
}

// Combine all events from both aggregates
export const events = {
  // Label Management Aggregate events
  ...labelEvents,

  // Thread Aggregate events
  ...threadEvents,
}

// Combine all materializers from both aggregates
const combinedMaterializers = {
  ...labelMaterializers,
  ...threadMaterializers,
}

// Create the LiveStore state
const state = State.SQLite.makeState({
  tables,
  materializers: combinedMaterializers,
})

export const schema = makeSchema({ events, state })
