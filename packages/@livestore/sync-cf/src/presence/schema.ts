import { Schema } from '@livestore/utils/effect'

/**
 * A member of a presence room: identity + liveness plus an opaque per-channel
 * `state` payload (validated against the channel's schema by the party).
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
 * Server → client snapshot of one channel's room. Sent whenever any member
 * joins, leaves, updates their state, or is pruned by the idle sweeper.
 */
export const PresenceSnapshot = Schema.Struct({
  storeId: Schema.String,
  channel: Schema.String,
  members: Schema.Array(PresenceMember),
}).annotate({ title: 'PresenceSnapshot' })

export type PresenceSnapshot = typeof PresenceSnapshot.Type

/**
 * Wire payloads for the presence RPCs. The `state` field travels as JSON and
 * is decoded/validated server-side against the channel's registered schema.
 */
export const PresenceJoinPayload = Schema.Struct({
  storeId: Schema.String,
  channel: Schema.String,
  clientId: Schema.String,
  name: Schema.optional(Schema.String),
})

export const PresenceUpdatePayload = Schema.Struct({
  storeId: Schema.String,
  channel: Schema.String,
  clientId: Schema.String,
  /** JSON-encoded partial state; merged over the member's current state. */
  patch: Schema.Json,
})

export const PresenceLeavePayload = Schema.Struct({
  storeId: Schema.String,
  channel: Schema.String,
  clientId: Schema.String,
})

export const PresenceSnapshotsPayload = Schema.Struct({
  storeId: Schema.String,
  channel: Schema.String,
})