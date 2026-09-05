# 0003 — Ephemeral presence rooms inside the sync Durable Object

Status: accepted (recorded 2026-08-27).

## Context

High-frequency, short-lived state (cursors, typing, live drags) must not
enter the eventlog: at 30–50 Hz it would flood every client's SQLite and
is meaningless after ~100ms. The same app still needs the durable log
for the facts those gestures produce (a card moved, a message sent).

A single store often has many isolation domains (one typing indicator
per conversation). Broadcasting every cursor to every client of the
store is the wrong default.

## Options

- **(a) Rooms inside the sync DO — chosen.** One Durable Object per
  `storeId` already exists. Presence is an in-memory hub keyed by
  `roomId`, with typed channels inside each room, riding the same
  WebSocket and `validatePayload` gate as pull/push. Authz is
  `onJoin`/`onUpdate` (same shape as `onPush`). Rate-limit
  `PresenceUpdate` per client.
- **(b) A second Durable Object class per room.** Rejected for the
  first cut: doubles connections, splits auth, and hibernates
  independently of the log the app already paid for. Revisit if a
  room must outlive the store or span stores.
- **(c) Channels-as-rooms.** Rejected: channel names are declared
  schemas, not dynamic ids. A chat app cannot pre-declare every
  conversation as a schema key.

## Evidence

Kanban example (`livestore-contrib` `examples/web-kanban-presence`)
and unit tests in `packages/@livestore/sync-cf/src/presence/*.test.ts`
(hub isolation, hook rejection, rate limit, schema decode).

## Consequences

- Presence is WebSocket-only. HTTP and DO-RPC transports have no
  presence methods.
- Room membership is not durable across isolate eviction; clients
  re-join / the next update recreates the member.
- Persisting a presence-adjacent fact is a client `store.commit` (or
  a hook side-effect), never an implicit eventlog write.
