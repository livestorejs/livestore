import { nanoid, type Store } from '@livestore/livestore'
import type { schema } from './schema.ts'
import { inboxEvents } from './schema.ts'

/**
 * Seed data for Inbox aggregate.
 *
 * Note: threadIndex and threadLabels tables are NOT seeded here.
 * They are projections that are automatically populated via cross-aggregate
 * synchronization when Thread aggregates emit events (threadCreated, threadLabelApplied, etc.)
 */
export const seedInbox = (store: Store<typeof schema>) => {
  try {
    const now = new Date()

    console.log('🌱 Batching all seed events for atomic commit...')

    // Collect all events to commit in a single batch
    const allEvents = []

    console.log('🏷️ Preparing labels...')

    const inboxLabelId = 'inbox-label-id' // TODO: use a generated ID

    const labels: { id?: string; name: string; type: 'system' | 'user'; color: string; displayOrder: number }[] = [
      { id: inboxLabelId, name: 'INBOX', type: 'system', color: '#1f2937', displayOrder: 1 },
      { name: 'SENT', type: 'system', color: '#059669', displayOrder: 2 },
      { name: 'ARCHIVE', type: 'system', color: '#7c3aed', displayOrder: 3 },
      { name: 'TRASH', type: 'system', color: '#dc2626', displayOrder: 4 },
      { name: 'Travel', type: 'user', color: '#0ea5e9', displayOrder: 5 },
      { name: 'Receipts', type: 'user', color: '#84cc16', displayOrder: 6 },
    ]

    for (const label of labels) {
      allEvents.push(
        inboxEvents.labelCreated({
          id: label.id || nanoid(),
          name: label.name,
          type: label.type,
          color: label.color,
          displayOrder: label.displayOrder,
          createdAt: now,
        }),
      )
    }

    console.log(`📦 Committing ${allEvents.length} events in single batch...`)

    // Commit all events atomically - this ensures proper sync timing
    store.commit(...allEvents)

    console.log('✅ Inbox aggregate seed data created successfully!')
    console.log('📊 Summary:')
    console.log('  - 4 system labels (INBOX, SENT, ARCHIVE, TRASH)')
    console.log('  - 2 user labels (Travel, Receipts)')
    console.log(`  - All ${allEvents.length} events committed atomically for proper client sync`)
  } catch (error) {
    console.error('Failed to seed Inbox aggregate data:', error)
    throw error
  }
}
