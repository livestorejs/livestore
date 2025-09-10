import { Events, Schema, State } from '@livestore/livestore'

/**
 * Label Management Aggregate
 *
 * Purpose: Manages system labels (INBOX, SENT, ARCHIVE, TRASH) and label message counts
 * Event Log: Small (~1MB), always cached on client
 *
 * This aggregate handles:
 * - System label definitions and metadata
 * - Label message counts (updated by cross-aggregate events)
 * - Label organization and display properties
 */

// Tables for Label Management Aggregate
export const labelTables = {
  labels: State.SQLite.table({
    name: 'labels',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      type: State.SQLite.text(), // 'system' | 'user' (user labels out of scope for prototype)
      color: State.SQLite.text(),
      messageCount: State.SQLite.integer({ default: 0 }),
      displayOrder: State.SQLite.integer({ default: 0 }), // Display order in UI
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
}

// Events for Label Management Aggregate
export const labelEvents = {
  // System label creation (happens during seed/initialization)
  labelCreated: Events.synced({
    name: 'v1.LabelCreated',
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: Schema.Literal('system', 'user'),
      color: Schema.String,
      displayOrder: Schema.Number,
      createdAt: Schema.Date,
    }),
  }),

  // Cross-aggregate event: triggered when thread labels are applied/removed
  labelMessageCountUpdated: Events.synced({
    name: 'v1.LabelMessageCountUpdated',
    schema: Schema.Struct({
      labelId: Schema.String,
      delta: Schema.Number, // +1 when applied, -1 when removed
      updatedAt: Schema.Date,
    }),
  }),
}

// Materializers for Label Management Aggregate
export const labelMaterializers = State.SQLite.materializers(labelEvents, {
  'v1.LabelCreated': ({ id, name, type, color, displayOrder, createdAt }) =>
    labelTables.labels.insert({ id, name, type, color, displayOrder, messageCount: 0, createdAt }),

  'v1.LabelMessageCountUpdated': ({ labelId, delta }, ctx) => {
    const previousMessageCount = ctx.query(labelTables.labels.select('messageCount').where({ id: labelId }).first())
    if (!previousMessageCount) console.warn(`Label with ID ${labelId} not found for message count update`)
    const newMessageCount = (previousMessageCount || 0) + delta
    return labelTables.labels.update({ messageCount: newMessageCount }).where({ id: labelId })
  },
})
