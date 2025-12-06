import { queryDb, type Store } from '@livestore/livestore'
import { type schema as mailboxSchema, mailboxTables } from '../mailbox/schema.ts'
import { threadEvents, type schema as threadSchema, threadTables } from './schema.ts'

export function applyUserLabelToThread(
  threadStore: Store<typeof threadSchema>,
  params: {
    threadId: string
    labelId: string
  },
): void {
  try {
    threadStore.commit(
      threadEvents.threadLabelApplied({
        threadId: params.threadId,
        labelId: params.labelId,
        appliedAt: new Date(),
      }),
    )
  } catch (error) {
    console.error(`Failed to apply user label ${params.labelId} to thread ${params.threadId}:`, error)
  }
}

export function removeUserLabelFromThread(
  threadStore: Store<typeof threadSchema>,
  params: {
    threadId: string
    labelId: string
  },
): void {
  try {
    threadStore.commit(
      threadEvents.threadLabelRemoved({
        threadId: params.threadId,
        labelId: params.labelId,
        removedAt: new Date(),
      }),
    )
  } catch (error) {
    console.error(`Failed to remove user label ${params.labelId} from thread ${params.threadId}:`, error)
  }
}

export function archiveThread(
  threadStore: Store<typeof threadSchema>,
  mailboxStore: Store<typeof mailboxSchema>,
  params: {
    threadId: string
  },
): void {
  // Query necessary data
  const systemLabels = mailboxStore.query(queryDb(mailboxTables.labels.where({ type: 'system' })))
  const threadLabels = threadStore.query(queryDb(threadTables.threadLabels.where({})))

  // Find current system label
  const threadSystemLabels = systemLabels.filter((l) => threadLabels.some((tl) => tl.labelId === l.id))
  if (threadSystemLabels.length !== 1) throw new Error('Thread must have exactly one system label applied')
  const currentSystemLabel = threadSystemLabels[0]

  // Find archive label
  const archiveLabel = systemLabels.find((l) => l.name === 'ARCHIVE')
  if (!archiveLabel) throw new Error('ARCHIVE label not found')

  const now = new Date()
  try {
    threadStore.commit(
      threadEvents.threadLabelRemoved({
        threadId: params.threadId,
        labelId: currentSystemLabel.id,
        removedAt: now,
      }),
      threadEvents.threadLabelApplied({
        threadId: params.threadId,
        labelId: archiveLabel.id,
        appliedAt: now,
      }),
    )
  } catch (error) {
    console.error('Failed to archive thread:', error)
  }
}

export function trashThread(
  threadStore: Store<typeof threadSchema>,
  mailboxStore: Store<typeof mailboxSchema>,
  params: {
    threadId: string
  },
): void {
  // Query necessary data
  const systemLabels = mailboxStore.query(queryDb(mailboxTables.labels.where({ type: 'system' })))
  const threadLabels = threadStore.query(queryDb(threadTables.threadLabels.where({})))

  // Find current system label
  const threadSystemLabels = systemLabels.filter((l) => threadLabels.some((tl) => tl.labelId === l.id))
  if (threadSystemLabels.length !== 1) throw new Error('Thread must have exactly one system label applied')
  const currentSystemLabel = threadSystemLabels[0]

  // Find trash label
  const trashLabel = systemLabels.find((l) => l.name === 'TRASH')
  if (!trashLabel) throw new Error('TRASH label not found')

  const now = new Date()
  try {
    threadStore.commit(
      threadEvents.threadLabelRemoved({
        threadId: params.threadId,
        labelId: currentSystemLabel.id,
        removedAt: now,
      }),
      threadEvents.threadLabelApplied({
        threadId: params.threadId,
        labelId: trashLabel.id,
        appliedAt: now,
      }),
    )
  } catch (error) {
    console.error('Failed to trash thread:', error)
  }
}
