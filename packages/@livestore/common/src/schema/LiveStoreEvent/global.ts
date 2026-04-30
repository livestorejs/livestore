import { Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../EventSequenceNumber/mod.ts'

/**
 * Effect Schema for global events with integer sequence numbers.
 * @example
 * ```ts
 * const event: LiveStoreEvent.Global.Encoded = {
 *   name: 'todoCreated-v1',
 *   args: { id: 'abc', text: 'Buy milk' },
 *   seqNum: 5,       // This event's position in the global log
 *   parentSeqNum: 4, // Points to the previous event
 *   clientId: 'client-xyz',
 *   sessionId: 'session-123'
 * }
 * ```
 */
export const Encoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
  seqNum: EventSequenceNumber.Global.Schema,
  parentSeqNum: EventSequenceNumber.Global.Schema,
  clientId: Schema.String,
  sessionId: Schema.String,
}).annotations({ title: 'LiveStoreEvent.Global.Encoded' })

/** Event with integer sequence numbers for sync backend wire format. */
export type Encoded = typeof Encoded.Type

/** Converts a Global event to Client format by expanding integer seqNums to composite form. */
export const toClientEncoded = (
  event: Encoded,
): {
  name: string
  args: any
  seqNum: EventSequenceNumber.Client.Composite
  parentSeqNum: EventSequenceNumber.Client.Composite
  clientId: string
  sessionId: string
} => ({
  ...event,
  seqNum: EventSequenceNumber.Client.fromGlobal(event.seqNum),
  parentSeqNum: EventSequenceNumber.Client.fromGlobal(event.parentSeqNum),
})
