import { Schema } from '@livestore/livestore'
import type { LiveStoreEvent } from '@livestore/common/schema'
import type * as SyncBackend from '@livestore/sync-cf/cf-worker'

import { mailboxEvents } from '../stores/mailbox/schema.ts'
import { threadEvents } from '../stores/thread/schema.ts'
import type { MailboxClientDO } from './MailboxClientDO.ts'
import type { ThreadClientDO } from './ThreadClientDO.ts'

// ── Helpers ──

/** Derives a `{ name, args }` schema from an EventDef, using typeSchema so Encoded=Type (no double Date conversion). */
const eventInputSchema = <TName extends string, TType, TEncoded>(eventDef: { name: TName; schema: Schema.Schema<TType, TEncoded> }) =>
  Schema.Struct({ name: Schema.Literal(eventDef.name), args: Schema.typeSchema(eventDef.schema) })

type Invert<T extends Record<string, string>> = { [K in keyof T as T[K] & string]: K }
const invertRecord = <const T extends Record<string, string>>(record: T) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [v, k])) as Invert<T>

// ── Cross-Store Wire Format ──
// Uses { name, args } envelope. Schema.Date in the event schemas handles Date ↔ ISO string
// automatically, so the Encoded form is JSON-serializable for the queue.

export const CrossStoreEventSchema = Schema.Union(
  Schema.Struct({
    name: Schema.Literal('v1.ThreadCreated'),
    args: Schema.Struct({
      id: Schema.String,
      subject: Schema.String,
      participants: Schema.Array(Schema.String),
      createdAt: Schema.Date,
    }),
  }),
  Schema.Struct({
    name: Schema.Literal('v1.ThreadLabelApplied'),
    args: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      appliedAt: Schema.Date,
    }),
  }),
  Schema.Struct({
    name: Schema.Literal('v1.ThreadLabelRemoved'),
    args: Schema.Struct({
      threadId: Schema.String,
      labelId: Schema.String,
      removedAt: Schema.Date,
    }),
  }),
)

// ── Thread ↔ CrossStore ──

const threadToCrossStoreName = {
  'v1.ThreadCreated': 'v1.ThreadCreated',
  'v1.ThreadLabelApplied': 'v1.ThreadLabelApplied',
  'v1.ThreadLabelRemoved': 'v1.ThreadLabelRemoved',
} as const

export const ThreadEventInputSchema = Schema.Union(
  eventInputSchema(threadEvents.threadCreated),
  eventInputSchema(threadEvents.threadLabelApplied),
  eventInputSchema(threadEvents.threadLabelRemoved),
)

const ThreadEventFromCrossStoreEvent = Schema.transform(
  CrossStoreEventSchema,
  ThreadEventInputSchema,
  {
    strict: false,
    decode: ({ name, args }) => ({ name: invertRecord(threadToCrossStoreName)[name], args }),
    encode: ({ name, args }) => ({ name: threadToCrossStoreName[name], args }),
  },
)

// ── CrossStore ↔ Mailbox ──

const crossStoreToMailboxName = {
  'v1.ThreadCreated': 'v1.ThreadAdded',
  'v1.ThreadLabelApplied': 'v1.ThreadLabelApplied',
  'v1.ThreadLabelRemoved': 'v1.ThreadLabelRemoved',
} as const

const MailboxEventInputSchema = Schema.Union(
  eventInputSchema(mailboxEvents.threadAdded),
  eventInputSchema(mailboxEvents.threadLabelApplied),
  eventInputSchema(mailboxEvents.threadLabelRemoved),
)

const MailboxEventFromCrossStoreEvent = Schema.transform(
  CrossStoreEventSchema,
  MailboxEventInputSchema,
  {
    strict: false,
    decode: ({ name, args }) => ({ name: crossStoreToMailboxName[name], args }),
    encode: ({ name, args }) => ({ name: invertRecord(crossStoreToMailboxName)[name], args }),
  },
)

// ── Public API ──

export type CrossStoreEventEncoded = typeof CrossStoreEventSchema.Encoded

export type ThreadCrossStoreEvent =
  | LiveStoreEvent.ForEventDef.Decoded<typeof threadEvents.threadCreated>
  | LiveStoreEvent.ForEventDef.Decoded<typeof threadEvents.threadLabelApplied>
  | LiveStoreEvent.ForEventDef.Decoded<typeof threadEvents.threadLabelRemoved>


/** Encode a thread store event into the cross-store wire format (JSON-serializable). */
export const encodeThreadEvent = (event: ThreadCrossStoreEvent): CrossStoreEventEncoded =>
  Schema.encodeSync(ThreadEventFromCrossStoreEvent)(event)

/** Decode a cross-store wire event into a mailbox event input (ready for store.commit). */
export const decodeCrossStoreEvent = Schema.decodeSync(MailboxEventFromCrossStoreEvent)

export type Env = {
  MAILBOX_CLIENT_DO: SyncBackend.CfTypes.DurableObjectNamespace<MailboxClientDO>
  THREAD_CLIENT_DO: SyncBackend.CfTypes.DurableObjectNamespace<ThreadClientDO>
  SYNC_BACKEND_DO: SyncBackend.CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  CROSS_STORE_EVENTS_QUEUE: Queue<typeof CrossStoreEventSchema.Encoded>
}
