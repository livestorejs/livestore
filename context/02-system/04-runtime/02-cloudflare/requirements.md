# Cloudflare Runtime — Requirements

The server-side realization of the runtime contract: LiveStore running inside
a Cloudflare Durable Object as a headless client. Refines
[../requirements.md](../requirements.md) (`LS.SYS.RT-*`).

## Requirements

- **LS.SYS.RT.CF-R01 Colocated topology:** One Durable Object hosts exactly one
  client: session and leader run in the same context, so no cross-context
  transport or leader election is needed. `refines: LS.SYS.RT-R01`
- **LS.SYS.RT.CF-R02 DO-storage persistence:** `refines: LS.SYS.RT-R09` —
  Eventlog and state persist through the Durable Object storage-backed SQLite
  VFS (required pragmas enforced), surviving DO eviction.
- **LS.SYS.RT.CF-R03 RPC sync path:** The DO client syncs with the sync backend
  DO via a typed RPC stub; optional live pull delivers updates through DO-RPC
  callbacks instead of polling.
- **LS.SYS.RT.CF-R04 Server-side parity:** The DO client materializes with the
  same WASM SQLite build and materializers as browser clients, so
  server-derived state equals client-derived state. `refines: LS-R05`
- **LS.SYS.RT.CF-R05 Headless operation:** Devtools are disabled; the DO client
  is operated through the Store API only.
- **LS.SYS.RT.CF-R06 Accepted commit-loss window:** Commits acked to the
  colocated in-process session but not yet flushed to disk may be lost on
  abrupt isolate termination. This window is accepted (platform default; no
  forced `ctx.storage.sync()` before ack). It must never be externally
  observable: outbound messages and backend pushes are output-gated on the
  flush (see
  [.reference/cloudflare-do-durability.md](./.reference/cloudflare-do-durability.md)).
  Decided 2026-07-16 (interview).
