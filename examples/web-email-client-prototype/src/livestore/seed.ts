import { nanoid, type Store } from '@livestore/livestore'
import type { schema } from './schema.ts'
import { events } from './schema.ts'

/**
 * Seed data for Email Client Prototype
 *
 * Creates mock data to demonstrate the two-aggregate architecture:
 * 1. System labels (INBOX, SENT, ARCHIVE, TRASH)
 * 2. A single email thread with 4 messages
 * 3. Thread-label associations
 */

export const seedEmailClientData = (store: Store<typeof schema>) => {
  try {
    const now = new Date()

    console.log('🌱 Batching all seed events for atomic commit...')

    // Collect all events to commit in a single batch (recommended LiveStore pattern)
    const allEvents = []

    // 1. Create labels (Label Management Aggregate)
    console.log('🏷️ Preparing labels...')

    const inboxLabelId = nanoid()

    const systemLabels = [
      { id: inboxLabelId, name: 'INBOX', color: '#1f2937', displayOrder: 1 },
      { name: 'SENT', color: '#059669', displayOrder: 2 },
      { name: 'ARCHIVE', color: '#7c3aed', displayOrder: 3 },
      { name: 'TRASH', color: '#dc2626', displayOrder: 4 },
    ]

    for (const label of systemLabels) {
      allEvents.push(
        events.labelCreated({
          id: label.id || nanoid(),
          name: label.name,
          type: 'system' as const,
          color: label.color,
          displayOrder: label.displayOrder,
          createdAt: now,
        }),
      )
    }

    // Add user labels
    const userLabels = [
      { name: 'Travel', color: '#0ea5e9', displayOrder: 5 }, // Sky blue
      { name: 'Receipts', color: '#84cc16', displayOrder: 6 }, // Lime green
    ]

    for (const label of userLabels) {
      allEvents.push(
        events.labelCreated({
          id: nanoid(),
          name: label.name,
          type: 'user' as const,
          color: label.color,
          displayOrder: label.displayOrder,
          createdAt: now,
        }),
      )
    }

    // 2. Create a sample email thread (Thread Aggregate)
    console.log('📧 Preparing sample email thread...')

    const threadId = nanoid()

    // Create the thread
    allEvents.push(
      events.threadCreated({
        id: threadId,
        subject: 'LiveStore Email Client Prototype Discussion',
        participants: ['alice@livestore.dev', 'bob@livestore.dev'],
        createdAt: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
      }),
    )

    // Create messages in the thread
    const messages = [
      {
        id: nanoid(),
        content:
          "Hi Bob! I've been working on this email client prototype using LiveStore. It demonstrates event sourcing with multiple aggregates. What do you think?",
        sender: 'alice@livestore.dev',
        senderName: 'Alice Cooper',
        timestamp: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
        type: 'received' as const,
      },
      {
        id: nanoid(),
        content:
          'That sounds amazing, Alice! I love how LiveStore handles real-time sync between aggregates. Can you show me the cross-aggregate event flow?',
        sender: 'bob@livestore.dev',
        senderName: 'Bob Smith',
        timestamp: new Date(now.getTime() - 3600000 * 1.5), // 1.5 hours ago
        type: 'sent' as const,
      },
      {
        id: nanoid(),
        content:
          "Sure! When you apply a label to a thread, the Thread aggregate emits ThreadLabelApplied events. The Label aggregate reacts to these events and updates message counts. It's a great example of eventual consistency!",
        sender: 'alice@livestore.dev',
        senderName: 'Alice Cooper',
        timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
        type: 'received' as const,
      },
      {
        id: nanoid(),
        content:
          'This is so cool! I can see how this would scale with the 1GB client limit by selectively loading thread event logs. The offline-first approach is perfect for email.',
        sender: 'bob@livestore.dev',
        senderName: 'Bob Smith',
        timestamp: new Date(now.getTime() - 1800000), // 30 minutes ago
        type: 'sent' as const,
      },
    ]

    // Add messages to the thread
    for (const message of messages) {
      if (message.type === 'received') {
        allEvents.push(
          events.messageReceived({
            id: message.id,
            threadId,
            content: message.content,
            sender: message.sender,
            senderName: message.senderName,
            timestamp: message.timestamp,
          }),
        )
      } else if (message.type === 'sent') {
        allEvents.push(
          events.messageSent({
            id: nanoid(),
            threadId,
            content: message.content,
            sender: message.sender,
            senderName: message.senderName,
            timestamp: message.timestamp,
          }),
        )
      }
    }

    // 3. Apply labels to the thread (demonstrates cross-aggregate events)
    console.log('🏷️ Preparing thread label associations...')

    // Apply INBOX label to the thread
    // This should trigger a cross-aggregate event ("v1.LabelMessageCountUpdated") to update INBOX message count
    allEvents.push(
      events.threadLabelApplied({
        threadId,
        labelId: inboxLabelId,
        appliedAt: now,
      }),
    )

    // 4. Mark some messages as read
    console.log('👁️ Preparing message read status...')

    // Mark first 3 messages as read (leaving the most recent unread)
    for (const messageId of messages.slice(0, 3).map((m) => m.id)) {
      allEvents.push(
        events.messageRead({
          messageId,
          isRead: true,
          timestamp: new Date(now.getTime() - 900000), // 15 minutes ago
        }),
      )
    }

    console.log(`📦 Committing ${allEvents.length} events in single batch...`)

    // Commit all events atomically - this ensures proper sync timing
    store.commit(...allEvents)

    console.log('✅ Email client seed data created successfully!')
    console.log('📊 Summary:')
    console.log('  - 4 system labels (INBOX, SENT, ARCHIVE, TRASH)')
    console.log('  - 2 user labels (Travel, Receipts)')
    console.log('  - 1 email thread with 4 messages')
    console.log('  - Cross-aggregate label associations')
    console.log('  - Mixed read/unread message states')
    console.log(`  - All ${allEvents.length} events committed atomically for proper client sync`)
  } catch (error) {
    console.error('Failed to seed email client data:', error)
    throw error
  }
}
