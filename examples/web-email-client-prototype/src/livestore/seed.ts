import type { Store } from '@livestore/livestore'
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
  const now = new Date()

  // 1. Create system labels (Label Management Aggregate)
  console.log('🏷️ Creating system labels...')

  const systemLabels = [
    { id: 'inbox', name: 'INBOX', color: '#1f2937', order: 1 },
    { id: 'sent', name: 'SENT', color: '#059669', order: 2 },
    { id: 'archive', name: 'ARCHIVE', color: '#7c3aed', order: 3 },
    { id: 'trash', name: 'TRASH', color: '#dc2626', order: 4 },
  ]

  for (const label of systemLabels) {
    store.commit(
      events.labelCreated({
        id: label.id,
        name: label.name,
        type: 'system' as const,
        color: label.color,
        order: label.order,
        createdAt: now,
      }),
    )
  }

  // 2. Create a sample email thread (Thread Aggregate)
  console.log('📧 Creating sample email thread...')

  const threadId = 'thread-prototype-demo'
  const participants = ['alice@livestore.dev', 'bob@livestore.dev']

  // Create the thread
  store.commit(
    events.threadCreated({
      id: threadId,
      subject: 'LiveStore Email Client Prototype Discussion',
      participants,
      createdAt: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
    }),
  )

  // Create messages in the thread
  const messages = [
    {
      id: 'msg-1',
      content:
        "Hi Bob! I've been working on this email client prototype using LiveStore. It demonstrates event sourcing with multiple aggregates. What do you think?",
      sender: 'alice@livestore.dev',
      senderName: 'Alice Cooper',
      timestamp: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
      type: 'received' as const,
    },
    {
      id: 'msg-2',
      content:
        'That sounds amazing, Alice! I love how LiveStore handles real-time sync between aggregates. Can you show me the cross-aggregate event flow?',
      sender: 'bob@livestore.dev',
      senderName: 'Bob Smith',
      timestamp: new Date(now.getTime() - 3600000 * 1.5), // 1.5 hours ago
      type: 'sent' as const,
    },
    {
      id: 'msg-3',
      content:
        "Sure! When you apply a label to a thread, the Thread aggregate emits ThreadLabelApplied events. The Label aggregate reacts to these events and updates message counts. It's a great example of eventual consistency!",
      sender: 'alice@livestore.dev',
      senderName: 'Alice Cooper',
      timestamp: new Date(now.getTime() - 3600000 * 1), // 1 hour ago
      type: 'received' as const,
    },
    {
      id: 'msg-4',
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
      store.commit(
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
      store.commit(
        events.messageSent({
          id: message.id,
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
  console.log('🏷️ Applying labels to thread...')

  // Apply INBOX label to the thread
  store.commit(
    events.threadLabelApplied({
      threadId,
      labelId: 'inbox',
      appliedAt: now,
    }),
  )

  // This should trigger a cross-aggregate event to update INBOX message count
  store.commit(
    events.labelMessageCountUpdated({
      labelId: 'inbox',
      delta: 1,
      updatedAt: now,
    }),
  )

  // 4. Mark some messages as read
  console.log('👁️ Setting message read status...')

  // Mark first 3 messages as read (leaving the most recent unread)
  for (const messageId of ['msg-1', 'msg-2', 'msg-3']) {
    store.commit(
      events.messageRead({
        messageId,
        isRead: true,
        timestamp: new Date(now.getTime() - 900000), // 15 minutes ago
      }),
    )
  }

  console.log('✅ Email client seed data created successfully!')
  console.log('📊 Summary:')
  console.log('  - 4 system labels (INBOX, SENT, ARCHIVE, TRASH)')
  console.log('  - 1 email thread with 4 messages')
  console.log('  - Cross-aggregate label associations')
  console.log('  - Mixed read/unread message states')
}
