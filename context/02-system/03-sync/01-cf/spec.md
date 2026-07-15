# Cloudflare Sync Provider — Spec

This document specifies the Cloudflare realization of the sync provider
contract. It builds on [requirements.md](./requirements.md); the contract
itself lives in the [parent spec](../spec.md).

## Status

Draft.

## Topology

```
client (SyncBackend impl, src/client/) ──ws | http | do-rpc──▶
  CF worker (src/cf-worker/worker.ts) ──▶ Durable Object per storeId
                                          (src/cf-worker/do/, ordered log)
```

One Durable Object instance per `storeId` serializes pushes (assigning
global sequence numbers) and fans out live pull streams to subscribers
(LS.SYS.SYNC.CF-R01).

## Transports

| Transport | Schema | Notes |
| --- | --- | --- |
| WebSocket | `ws-rpc-schema.ts` | live pull stream; default |
| HTTP | `http-rpc-schema.ts` | request/response pull pagination |
| DO-RPC | `do-rpc-schema.ts` | same-Cloudflare-app calls (e.g. `adapter-cloudflare`) |

Message payloads share `sync-message-types.ts`; the backend id
(`BackendId`) detects backend identity changes
(`BackendIdMismatchError`).

Server-side embedding of a LiveStore client inside Cloudflare (Durable
Object hosting a store) is `04-runtime/`'s adapter concern
(`adapter-cloudflare`), not part of this provider node.
