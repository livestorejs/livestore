import { Schema } from '@livestore/utils/effect'

import type { EventDef, EventDefRecord } from '../EventDef/mod.ts'
import type { LiveStoreSchema } from '../schema.ts'
import type * as ForEventDef from './for-event-def.ts'

/**
 * Effect Schema for validating/decoding input events with encoded args.
 * @example
 * ```ts
 * import { Schema } from '@effect/schema'
 * const decoded = Schema.decodeUnknownSync(LiveStoreEvent.Input.Encoded)(rawEvent)
 * ```
 */
export const Encoded = Schema.Struct({
  name: Schema.String,
  args: Schema.Any,
}).annotations({ title: 'LiveStoreEvent.Input.Encoded' })

/** Event without sequence numbers, with decoded (native TypeScript) args. */
export type Decoded = ForEventDef.InputDecoded<EventDef.Any>

/** Event without sequence numbers, with encoded (serialized) args. */
export type Encoded = ForEventDef.InputEncoded<EventDef.Any>

/** Union of all input event types for a given schema (type-safe event discrimination). */
export type ForSchema<TSchema extends LiveStoreSchema> = {
  [K in keyof TSchema['_EventDefMapType']]: ForEventDef.InputDecoded<TSchema['_EventDefMapType'][K]>
}[keyof TSchema['_EventDefMapType']]

/** Effect Schema union of all event types in an EventDefRecord (input format, no sequence numbers). */
export type ForRecord<TEventDefRecord extends EventDefRecord> = Schema.Schema<
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Type<TEventDefRecord[K]['schema']>
    }
  }[keyof TEventDefRecord],
  {
    [K in keyof TEventDefRecord]: {
      name: K
      args: Schema.Schema.Encoded<TEventDefRecord[K]['schema']>
    }
  }[keyof TEventDefRecord]
>

/**
 * Creates an Effect Schema union for all event types in a schema (input format, no sequence numbers).
 * @example
 * ```ts
 * const inputSchema = LiveStoreEvent.Input.makeSchema(schema)
 * const event = Schema.decodeUnknownSync(inputSchema)(rawEvent)
 * ```
 */
export const makeSchema = <TSchema extends LiveStoreSchema>(schema: TSchema): ForRecord<TSchema['_EventDefMapType']> =>
  Schema.Union(
    ...[...schema.eventsDefsMap.values()].map((def) =>
      Schema.Struct({
        name: Schema.Literal(def.name),
        args: def.schema,
      }),
    ),
  ).annotations({ title: 'LiveStoreEvent.Input' }) as any
