# 0002 — TypeScript with Effect as the implementation substrate

Status: accepted (founding decision; recorded 2026-07-16 from documented
history).

## Context

The engine is IO- and concurrency-heavy (sync processors, worker
topologies, retry/backoff, structured shutdown) and schema-driven (events,
state, queries). The implementation substrate shapes every package.

## Options

- **(a) TypeScript + Effect — chosen.** Documented rationale: build most of
  the library in TypeScript; "embrace and build on top of Effect as a
  library of powerful primitives, particularly for IO/concurrency heavy
  parts". Effect supplies schemas, typed errors, fibers/scopes, and
  structured concurrency the sync/runtime layers lean on.
- **(b) Plain TypeScript (Promises, ad hoc schemas).** Not chosen; no
  detailed comparison is documented beyond the "powerful primitives"
  rationale.
- **(c) Rust core.** Deferred, not rejected: "we might move more parts to
  Rust in the future." LS.SYS-A01 keeps the contracts language-neutral so
  parts can move without changing them.

## Evidence

Documented history: `docs/understanding-livestore/design-decisions.md`
(implementation decisions). Contract form: LS.SYS-A01. Implementation
evidence: Effect usage throughout `common`/`livestore`; the Effect-native
public surface (`08-integrations/02-effect/`).

## Consequences

- Effect types appear in public APIs; the shared peer-dependency set
  (`@livestore/peer-deps`) carries `effect`/`@effect/*`.
- An Effect-idiom realization of the integration contract exists
  (`Store.Tag`), beside the framework bindings.
- Contracts in this tree describe behavior, not Effect idioms, so a future
  substrate change stays a realization concern (LS.SYS-A01).
