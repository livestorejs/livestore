import { Schema } from '@livestore/utils/effect'

/**
 * Presence state for a single client. Ephemeral — never persisted, never
 * written to the eventlog or any SQLite database.
 */
export const PresenceState = Schema.Struct({
  /** Stable client identifier (e.g. the LiveStore `clientId`). */
  clientId: Schema.String,
  /** Human-readable display name, if provided. */
  name: Schema.optional(Schema.String),
  /** Whether the client is currently online (drives the online count). */
  online: Schema.Boolean,
  /** Whether the user is currently typing. */
  typing: Schema.optional(Schema.Boolean),
  /** Figma-style pointer position (viewport / board coordinates). */
  cursor: Schema.optional(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
  /** Google-Docs-style text cursor position within a document. */
  textCursor: Schema.optional(Schema.Finite),
  /** Which card is being dragged and the current drag delta (Figma/PartyKit-style). */
  dragging: Schema.optional(
    Schema.Struct({ cardId: Schema.String, deltaX: Schema.Finite, deltaY: Schema.Finite }),
  ),
  /** Unix epoch milliseconds of the last client update. */
  updatedAt: Schema.Finite,
}).annotate({ title: 'PresenceState' })

export type PresenceState = typeof PresenceState.Type

/**
 * Server → client broadcast of the full current room snapshot. Sent whenever
 * any member joins, leaves, or updates their state.
 */
export const PresenceSnapshot = Schema.Struct({
  storeId: Schema.String,
  clients: Schema.Array(PresenceState),
}).annotate({ title: 'PresenceSnapshot' })

export type PresenceSnapshot = typeof PresenceSnapshot.Type

/** Client → server: join the room. */
export const PresenceJoin = Schema.TaggedStruct('PresenceClient.join', {
  clientId: Schema.String,
  name: Schema.optional(Schema.String),
})

/** Client → server: update own presence state. */
export const PresenceUpdate = Schema.TaggedStruct('PresenceClient.state', {
  state: PresenceState,
})

/** Client → server: leave the room. */
export const PresenceLeave = Schema.TaggedStruct('PresenceClient.leave', {
  clientId: Schema.String,
})

/**
 * Client → server messages.
 */
export const PresenceClientMessage = Schema.Union([PresenceJoin, PresenceUpdate, PresenceLeave])
export type PresenceClientMessage = typeof PresenceClientMessage.Type

/** Server → client: full room snapshot. */
export const PresenceSnapshotMessage = Schema.TaggedStruct('PresenceServer.snapshot', {
  snapshot: PresenceSnapshot,
})

/** Server → client: error. */
export const PresenceErrorMessage = Schema.TaggedStruct('PresenceServer.error', {
  message: Schema.String,
})

/**
 * Server → client messages.
 */
export const PresenceServerMessage = Schema.Union([PresenceSnapshotMessage, PresenceErrorMessage])
export type PresenceServerMessage = typeof PresenceServerMessage.Type