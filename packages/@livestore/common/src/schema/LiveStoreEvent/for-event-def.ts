import type { Schema } from '@livestore/utils/effect'

import type { EventDef, EventDefRecord } from '../EventDef/mod.ts'
import type * as EventSequenceNumber from '../EventSequenceNumber/mod.ts'

/** Event without sequence numbers, with decoded (native TypeScript) args. Used as input to `store.commit()`. */
export type InputDecoded<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Type<TEventDef['schema']>
}

/** Event without sequence numbers, with encoded (serialized) args. Used as input to `store.commit()`. */
export type InputEncoded<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Encoded<TEventDef['schema']>
}

/** Full event with composite sequence numbers and decoded args. Includes clientId/sessionId for sync. */
export type Decoded<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Type<TEventDef['schema']>
  seqNum: EventSequenceNumber.Client.Composite
  parentSeqNum: EventSequenceNumber.Client.Composite
  clientId: string
  sessionId: string
}

/** Full event with composite sequence numbers and encoded args. Includes clientId/sessionId for sync. */
export type Encoded<TEventDef extends EventDef.Any> = {
  name: TEventDef['name']
  args: Schema.Schema.Encoded<TEventDef['schema']>
  seqNum: EventSequenceNumber.Client.Composite
  parentSeqNum: EventSequenceNumber.Client.Composite
  clientId: string
  sessionId: string
}

/** Effect Schema union of all event types in an EventDefRecord (with composite sequence numbers). */
export type ForRecord<TEventDefRecord extends EventDefRecord> = Schema.Schema<
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Type<TEventDefRecord[K]['schema']>
      seqNum: EventSequenceNumber.Client.Composite
      parentSeqNum: EventSequenceNumber.Client.Composite
      clientId: string
      sessionId: string
    }
  }[keyof TEventDefRecord],
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Encoded<TEventDefRecord[K]['schema']>
      seqNum: EventSequenceNumber.Client.Composite
      parentSeqNum: EventSequenceNumber.Client.Composite
      clientId: string
      sessionId: string
    }
  }[keyof TEventDefRecord]
>
