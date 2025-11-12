import { nanoid, type Store } from '@livestore/livestore'
import type { schema } from './schema.ts'
import { threadEvents } from './schema.ts'

/**
 * Seed data for Thread store.
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
        subject: 'LiveStore Email Client Discussion',
        participants: ['alice@livestore.dev', 'bob@livestore.dev'],
        createdAt: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
      }),
    )

    // Create messages for the thread
    const messages = [
      {
        id: nanoid(),
        content:
          "Hi! I've been working on this email client using LiveStore. It demonstrates event sourcing with multiple stores and cross-store synchronization.",
        sender: 'alice@livestore.dev',
        senderName: 'Alice Cooper',
        timestamp: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
      },
      {
        id: nanoid(),
        content:
          "When you apply a label to a thread, the Thread store emits ThreadLabelApplied events. The Mailbox store listens to these events via a Cloudflare Queue and updates its projection tables. It's a great example of eventual consistency!",
        sender: 'alice@livestore.dev',
        senderName: 'Alice Cooper',
        timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
      },
    ]

    // Add messages to the thread
    for (const message of messages) {
      allEvents.push(
        threadEvents.messageAdded({
          id: message.id,
          threadId,
          content: message.content,
          sender: message.sender,
          senderName: message.senderName,
          timestamp: message.timestamp,
        }),
      )
    }

    // Apply INBOX label to the thread
    // This should trigger a cross-store event ("v1.LabelThreadCountUpdated") to update INBOX thread count
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
