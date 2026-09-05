import { Schema } from '@livestore/utils/effect'

/** Room used when the client does not name one. One store can host many rooms. */
export const DEFAULT_PRESENCE_ROOM_ID = 'default'

/**
 * A member of a presence room: identity + liveness plus an opaque per-channel
 * `state` payload (validated against the channel's schema before fan-out).
 */
export const PresenceMember = Schema.Struct({
  clientId: Schema.String,
  name: Schema.optional(Schema.String),
  online: Schema.Boolean,
  /** Channel-validated state payload (JSON). */
  state: Schema.optional(Schema.Json),
  updatedAt: Schema.Finite,
}).annotate({ title: 'PresenceMember' })

export type PresenceMember = typeof PresenceMember.Type

/**
 * Server → client snapshot of one channel in one room. Emitted whenever any
 * member of that room+channel joins, leaves, updates, or is pruned.
 */
export const PresenceSnapshot = Schema.Struct({
  storeId: Schema.String,
  roomId: Schema.String,
  channel: Schema.String,
  members: Schema.Array(PresenceMember),
}).annotate({ title: 'PresenceSnapshot' })

export type PresenceSnapshot = typeof PresenceSnapshot.Type

export const PresenceJoinPayload = Schema.Struct({
  storeId: Schema.String,
  roomId: Schema.String,
  channel: Schema.String,
  clientId: Schema.String,
  name: Schema.optional(Schema.String),
})

export const PresenceUpdatePayload = Schema.Struct({
  storeId: Schema.String,
  roomId: Schema.String,
  channel: Schema.String,
  clientId: Schema.String,
  /** Full accumulated channel state (not a merge-patch). */
  patch: Schema.Json,
})

export const PresenceLeavePayload = Schema.Struct({
  storeId: Schema.String,
  roomId: Schema.String,
  channel: Schema.String,
  clientId: Schema.String,
})

export const PresenceSnapshotsPayload = Schema.Struct({
  storeId: Schema.String,
  roomId: Schema.String,
  channel: Schema.String,
})
