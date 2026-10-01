# 0006 — DO-RPC transport failures retry only when Cloudflare marks them retryable

Status: accepted (recorded 2026-10-01).

## Context

The DO-RPC client turned every rejected stub call and stream read into a defect
(`Effect.orDie`). The leader retries a pull only on `IsOfflineError`, so one
temporary failure (backend DO restart, deploy, lost connection) ended the pull
for good: the store shut down, or with `onError: 'ignore'` the pull loop
stopped. A push parked after `ServerAheadError` then waited forever for a pull
chunk, and replication stalled (#1462, leg 3). The client also reused one stub
for its whole life, though Cloudflare documents that many exceptions leave a
stub broken.

The WebSocket transport already treats a socket failure as offline: it
reconnects with its own backoff and maps the error to `IsOfflineError`.

## Options

- **(a) Classify by Cloudflare's error flags in the DO-RPC client — chosen.**
  `retryable` and not `overloaded` maps to `IsOfflineError`; overload and every
  other failure (including `remote`, which infrastructure errors can also
  carry) die with the original error, keeping today's terminal handling. The
  pull backoff lives in the transport, like the WebSocket reconnect backoff,
  because the leader restarts a failed pull immediately. A required
  `getSyncBackendStub` factory gives each call a fresh stub.
- **(b) Map transport failures to `UnknownError` and retry it in the leader.**
  Rejected: push already retries `UnknownError` indefinitely, so overload and
  application faults would retry forever, against Cloudflare's guidance, and
  the change would alter recovery for every sync backend.
- **(c) Keep a fixed stub option next to the factory.** Rejected: it keeps the
  broken-stub failure mode.

## Evidence

Cloudflare's error-handling guide: retry `retryable` errors, never retry
`overloaded` ones, `remote` can mark infrastructure errors, and many exceptions
leave a stub broken
(https://developers.cloudflare.com/durable-objects/best-practices/error-handling/).
Unit tests: `common-cf/src/do-rpc/client.test.ts` (typed per-request failure,
original error kept through stream cleanup, client usable after a failure) and
`sync-cf/src/client/transport/do-rpc-client.test.ts` (classification on pull and
push, application errors unchanged, backoff growth across page-then-fail pulls,
reset on completed catch-up, recovery on a fresh stub after a stub breaks).
`tests/sync-provider/src/do-rpc-transport-recovery.test.ts` runs the real leader
and DO-RPC client: a push parked on `ServerAheadError` resumes once a retryable
pull failure recovers, and times out with the previous `orDie` client.

## Consequences

- Breaking API: `createStoreDo`, `createStoreDoPromise` and `makeDoRpcSync`
  take `getSyncBackendStub: () => stub` instead of `syncBackendStub`.
- Recovery depends on Cloudflare setting `retryable`. Cloudflare documents the
  flags on rejected RPC calls; whether a failed stream read carries them is
  unverified. Without the flag, a mid-stream failure stays terminal.
- Push gets no transport backoff; the leader's push retry already backs off.
