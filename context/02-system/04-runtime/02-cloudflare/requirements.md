# Cloudflare Runtime — Requirements

The server-side realization of the runtime contract: LiveStore running inside
a Cloudflare Durable Object as a headless client. Refines
[../requirements.md](../requirements.md) (`LS.SYS.RT-*`).

## Requirements

- **LS.SYS.RT.CF-R01 Colocated topology:** `refines: LS.SYS.RT-R01` — One
  Durable Object hosts exactly one client: session and leader run in the same
  context, so no cross-context transport or leader election is needed.
- **LS.SYS.RT.CF-R02 DO-storage persistence:** `refines: LS.SYS.RT-R09` —
  Eventlog and state persist through the Durable Object storage-backed SQLite
  VFS (required pragmas enforced), surviving DO eviction.
- **LS.SYS.RT.CF-R03 RPC sync path:** The DO client syncs with the sync
  backend DO via a typed RPC stub; optional live pull delivers updates
  through DO-RPC callbacks instead of polling.
- **LS.SYS.RT.CF-R04 Server-side parity:** `refines: LS-R05` — The DO client
  materializes with the same WASM SQLite build and materializers as browser
  clients, so server-derived state equals client-derived state.
- **LS.SYS.RT.CF-R05 Headless operation:** Devtools are disabled; the DO
  client is operated through the Store API only.
