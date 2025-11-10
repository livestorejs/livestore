import { nanoid, type Store } from '@livestore/livestore'
import type { schema } from './schema.ts'
import { mailboxEvents } from './schema.ts'

/**
 * Seed data for Mailbox aggregate.
 *
 * Note: threadIndex and threadLabels tables are NOT seeded here.
 * They are projections that are automatically populated via cross-aggregate
 * synchronization when Thread aggregates emit events (threadCreated, threadLabelApplied, etc.)
 */
export const seedMailbox = (store: Store<typeof schema>): { inboxLabelId: string } => {
  try {
    console.log('🌱 Seeding Mailbox store data...')

    const now = new Date()

    // Collect all events to commit in a single batch
    const allEvents = []

    const inboxLabelId = nanoid()

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
        mailboxEvents.labelCreated({
          id: label.id || nanoid(),
          name: label.name,
          type: label.type,
          color: label.color,
          displayOrder: label.displayOrder,
          createdAt: now,
        }),
      )
    }

    // Commit all events atomically
    store.commit(...allEvents)

    console.log('✅ Mailbox store seed data created successfully!')
    return { inboxLabelId }
  } catch (error) {
    console.error('❌ Failed to seed Mailbox store data:', error)
    throw error
  }
}
