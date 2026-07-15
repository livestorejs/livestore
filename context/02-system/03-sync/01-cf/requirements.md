# Cloudflare Sync Provider — Requirements

Role: `01-cf/` is the in-repo reference realization of the sync provider
contract, running the backend in a Cloudflare Durable Object.

## Context

Builds on [../requirements.md](../requirements.md) (LS.SYS.SYNC-R06). Code:
`packages/@livestore/sync-cf/src/{cf-worker,client,common}/`.

## Requirements

- **LS.SYS.SYNC.CF-R01 Contract realization** (refines LS.SYS.SYNC-R06):
  Realizes the full provider contract — ordered persistence, live pull
  streams (`pullLive: true`), push validation — with one Durable Object as
  the ordering authority per store (refines LS.SYS.SYNC-R01).
- **LS.SYS.SYNC.CF-R02 Transport choice:** Clients reach the backend via
  WebSocket, HTTP, or DO-RPC without semantic differences; transport is a
  deployment decision.
- **LS.SYS.SYNC.CF-R03 Schema-defined messages** (refines LS.SYS-R02): All
  transports share the versioned message schemas in `src/common/`
  (`ws-rpc-schema.ts`, `http-rpc-schema.ts`, `do-rpc-schema.ts`,
  `sync-message-types.ts`).
- **LS.SYS.SYNC.CF-R04 Reference status:** Serves as the conformance
  baseline for the provider contract (`09-verification/`) and the deploy
  target for examples.
