# 0003 — Closing a store's scope is an orderly shutdown

Status: accepted (2026-09-25, refines [0001](./0001-client-session-shutdown-drain.md))

## Context

Decision 0001 made a successful orderly `store.shutdown()` flush every admitted
client commit to the leader. It did not cover the other way a store ends while
code can still run: the scope `createStore` runs in closes. That is how
integrations dispose stores (a `StoreRegistry` evicting an unused store after
`unusedCacheTime`, `registry.dispose()`), how Effect programs and tests end,
and how a Cloudflare Durable Object store's scope ends. The scope finalizer
closed the store's `lifetimeScope` directly, so a commit made just before the
close was dropped if it had not yet been acknowledged by the leader.

Upgrading to Effect 4.0.0-rc.113 surfaced this: fiber scheduling changed so an
in-flight session→leader push is now interrupted by the close
(`db-query.test.ts` trace snapshots), where on beta.99 the push simply had not
started yet. Both orderings lose the event.

## Options

- **A. Scope close drains (chosen).** The scope finalizer runs the same bounded
  drain as `store.shutdown()` for a successful exit, then closes the lifetime
  scope. Integrations get flush-on-shutdown without calling `shutdown()`.
- **B. Faster acknowledgement.** Remove scheduler round trips on the push path
  so the leader usually acknowledges before the close. Rejected: it only moves
  the race.
- **C. Document hard close as non-draining.** Tests wait for sync before
  closing. Rejected: keeps a silent loss path in the default integration
  lifecycle.

## Decision

A. `store.shutdown()` and scope close share one teardown that starts at most
once: drain the session sync processor under `SHUTDOWN_DRAIN_HARD_TIMEOUT_MS`,
then close the lifetime scope. Whoever triggered it waits at most 1s; the
detached teardown continues within its hard bound. A failed or interrupted
scope exit does not drain, matching failed `shutdown()`.

## Consequences

- Disposing a store through its scope can take up to the 1s soft bound instead
  of returning immediately.
- A drain failure during scope close is logged, not raised from the finalizer,
  and a teardown already started by `shutdown()` is not reported twice.
- Tab close, a crash or a killed process still cannot drain; the
  `confirmUnsavedChanges` prompt covers pending events in browsers, and
  persist-before-admit remains the future target (LS.SYS.STORE-DQ1).
- Trace snapshots that close scopes after committing now show completed leader
  pushes.
- Spec updates: LS.SYS.SYNC.PROC-R03 names scope close as orderly shutdown; the
  store lifecycle section and the processor shutdown drain describe the shared
  teardown.
