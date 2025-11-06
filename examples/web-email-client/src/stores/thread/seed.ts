import { nanoid, type Store } from '@livestore/livestore'
import type { schema } from './schema.ts'
import { threadEvents } from './schema.ts'

/**
 * Seed data for Thread aggregate.
 */
export const seedThread = ({
  store,
  threadId,
  inboxLabelId,
}: {
  store: Store<typeof schema>
  threadId: string
  inboxLabelId: string
}) => {
  try {
    console.log(`🌱 Seeding Thread store data for thread ID: ${threadId}...`)

    const now = new Date()

    // Collect all events to commit in a single batch
    const allEvents = []

    // Create the thread
    allEvents.push(
      threadEvents.threadCreated({
        id: threadId,
        subject: 'LiveStore Email Client Prototype Discussion',
        participants: ['alice@livestore.dev', 'bob@livestore.dev'],
        createdAt: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
      }),
    )

    // Create messages for the thread
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
          "Sure! When you apply a label to a thread, the Thread aggregate emits ThreadLabelApplied events. The Label aggregate reacts to these events and updates thread counts. It's a great example of eventual consistency!",
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
          threadEvents.messageReceived({
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
          threadEvents.messageSent({
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

    // Apply INBOX label to the thread
    // This should trigger a cross-aggregate event ("v1.LabelThreadCountUpdated") to update INBOX thread count
    allEvents.push(
      threadEvents.threadLabelApplied({
        threadId,
        labelId: inboxLabelId,
        appliedAt: now,
      }),
    )

    // Commit all events atomically
    store.commit(...allEvents)

    console.log(`✅ Thread store seed data for thread ID: ${threadId} created successfully!`)
  } catch (error) {
    console.error('❌ Failed to seed Thread store data:', error)
    throw error
  }
}
