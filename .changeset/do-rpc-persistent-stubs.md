---
'@livestore/sync-cf': minor
'@livestore/common-cf': minor
'@livestore/adapter-cloudflare': minor
---

Deliver DO-RPC live updates through Cloudflare persistent stubs (`ctx.restore`) instead of calling the client Durable Object back by binding name and id. The sync backend can no longer be pointed at an arbitrary DO id, and a subscription whose client is gone is dropped on the next publish instead of leaking.

Breaking for Durable Object clients: `createStoreDo` no longer takes `durableObject.env` or `durableObject.bindingName`; the `syncUpdateRpc` method is replaced by a `[restore]` method (symbol from `cloudflare:workers`) returning `restoreStoreDoSyncTarget(this.ctx, params, { onUpdate })`. Every Worker in the restore chain needs the experimental `allow_irrevocable_stub_storage` compatibility flag. Compatibility dates before 2026-01-20 also need `rpc_params_dup_stubs`.
