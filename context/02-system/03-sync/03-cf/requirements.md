# Cloudflare Sync Provider — Requirements

Role: `03-cf/` is the in-repo reference realization of the sync provider
contract, running the backend in a Cloudflare Durable Object.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS.SYNC-R02). Code:
`packages/@livestore/sync-cf/src/{cf-worker,client,common}/`.

## Requirements

- **LS.SYS.SYNC.CF-R01 Contract realization:** Realizes the full provider
  contract — ordered persistence, live pull (`pullLive: true`), push
  arbitration — with one Durable Object as the ordering authority per
  store. `refines: LS.SYS.SYNC-R02, LS.SYS.SYNC-R01`
- **LS.SYS.SYNC.CF-R02 Transport choice:** Clients reach the backend via
  WebSocket, HTTP, or DO-RPC. The pull/push results converge, but the
  transports differ semantically in how liveness is achieved (WS
  server-held stream, HTTP client-side polling, DO-RPC callback queue) and
  in operational bounds; the differences are specified, not hidden.
- **LS.SYS.SYNC.CF-R03 Schema-defined messages:** All transports share the
  message schemas in `src/common/` (`sync-message-types.ts` plus
  per-transport RPC schemas). Wire messages carry no protocol version;
  compatibility relies on structural schema decoding, and persistence is
  versioned separately (`PERSISTENCE_FORMAT_VERSION` baked into table
  names; bumping soft-resets stored data). `refines: LS.SYS-R02`
- **LS.SYS.SYNC.CF-R04 Reference status:** Serves as the conformance
  baseline for the provider contract (`09-verification/`) and the deploy
  target for examples.
