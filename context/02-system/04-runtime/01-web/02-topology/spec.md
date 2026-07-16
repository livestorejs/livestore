# Web Topology — Spec

This document specifies the browser worker graph and port wiring. It builds
on [requirements.md](./requirements.md); who becomes leader is
[../03-leadership/](../03-leadership/spec.md).

## Status

Draft.

## Worker Graph

```
tab 1 (main thread)      tab 2 (main thread)
  client session           client session
  in-memory SQLite         in-memory SQLite
       │ RPC                    │ RPC
       └──────┬─────────────────┘
              ▼
        shared worker          livestore-shared-worker-<storeId>
              │ MessagePort    (mediator; holds no state of its own)
              ▼
        leader worker          livestore-worker-<storeId>-<sessionId>
                               hosts makeLeaderThreadLayer
```

- Tabs talk to the shared worker over an Effect RpcClient
  (`SharedWorkerRpcs`); nearly all RPCs are pure pass-throughs to the
  current leader (`make-shared-worker.ts:222-240`).
- The shared worker parses its `storeId` from `self.name`
  (`make-shared-worker.ts:31`).

## Two-Layer Initial Messages

The leader worker is bootstrapped in two layers
(`make-leader-worker.ts:99-181`):

1. **Outer** — the spawning tab creates a `MessageChannel`, sends
   `LeaderWorkerOuterInitialMessage` `{port: mc.port1, storeId, clientId}`
   to the dedicated worker; an `RpcServer` for `LeaderWorkerInnerRpcs` is
   then served over that port via a hand-rolled `RpcServer.Protocol`
   (ack, transferables, span propagation).
2. **Inner** — the first inner message carries
   `{storageOptions, storeId, clientId, devtoolsEnabled, debugInstanceId,
   syncPayloadEncoded}`; the leader-thread context is built once from it
   (`Effect.cached`).

`syncPayloadSchema` never crosses the worker boundary (Effect schemas are
not structured-cloneable); the schema travels with the worker bundle and
only the encoded payload is sent (`persisted-adapter.ts:195-200`;
LS.SYS.RT.WEB.TOPO-R02).

## Port Swap and Mediation

Only the leader-elect tab spawns the dedicated worker and hands `mc.port2`
to the shared worker via `UpdateMessagePort`, together with the invariant
payload (`persisted-adapter.ts:343-359`). The shared worker
(`make-shared-worker.ts:149-219`):

- keeps a single active leader context (`leaderWorkerContextSubRef`);
  requests arriving with no leader queue on `waitForWorker` — a swap drops
  no requests (LS.SYS.RT.WEB.TOPO-R03);
- on swap, unsets the context first (new requests queue), closes the
  previous leader scope, builds a fresh RpcClient over the incoming port,
  and rewires the devtools webmesh connection;
- enforces **invariant stability** across swaps — `storeId`,
  `storageOptions`, `syncPayloadEncoded`, `liveStoreVersion`,
  `devtoolsEnabled` must match what the first leader registered; a mismatch
  fails with a schema diff (`make-shared-worker.ts:135-171`). Consequence:
  devtools-on and devtools-off tabs of one store cannot coexist.
- resets the leader context on any shutdown broadcast.

## Boot-Status Proxying

`BootStatusStream` is proxied tab ← shared worker ← leader into the
session's boot-status queue; the proxy fiber is interrupted once boot
settles (`persisted-adapter.ts:416-432`). Realizes the parent boot-progress
contract (`LS.SYS.RT-R11`).
