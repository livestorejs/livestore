# LiveStore — Requirements

## Context

Builds on [vision.md](./vision.md). These are the product-level constraints;
branch nodes refine them with scoped IDs (`refines:`). See
[spec.md](./spec.md) for the branch structure and ID scheme.

## Assumptions

- **LS-A01 Client-sized data:** All data for one store fits in a client-side
  in-memory SQLite database (up to ~1 GB per store depending on the target
  device).
- **LS-A02 Small/medium write concurrency:** A single eventlog serves 10s to
  low 100s of concurrent writers. Apps scale horizontally across many
  stores/eventlogs, not by growing one log.
- **LS-A03 Greenfield source of truth:** Apps adopt the LiveStore eventlog as
  the source of truth from the start. Reusing an existing server database as
  the source of truth is out of scope.
- **LS-A04 Two-repo delivery:** The product ships from `livestorejs/livestore`
  (core) and `livestorejs/livestore-contrib` under one product identity.
  Refined by `03-delivery/`.
- **LS-A05 No company:** Development is sustained by sponsorship and community
  maintenance. Refined by `06-sustainability/`.

## Acceptable Tradeoffs

- **LS-T01 Bundle size:** Bundling SQLite (a few hundred kB) is accepted in
  exchange for full SQL query power on the client.
- **LS-T02 Per-session memory:** An in-memory state database per client
  session is accepted to keep the read path synchronous.
- **LS-T03 Learning curve:** The conceptual overhead of event sourcing is
  accepted; beginners are not the target audience.
- **LS-T04 Migration by rebuild:** Read-model changes are handled by
  rebuilding state from the eventlog rather than migrating state in place;
  the rebuild cost is accepted.

## Requirements

### One model for the data layer

- **LS-R01 Unified layer:** One library provides state management,
  persistence, offline operation, and sync through the single event-sourcing
  model — an app needs no additional glue between these concerns.
- **LS-R02 Local source of truth:** Reads are served synchronously from a
  local database; the read path never requires a network round-trip.
- **LS-R03 Offline by default:** All functionality works without a network
  connection; clients converge after reconnecting.

### Deterministic event-sourced core

- **LS-R04 Canonical eventlog:** The append-only eventlog is the only source
  of truth; all queryable state is derived from it.
- **LS-R05 Determinism:** The same eventlog produces identical state on every
  client and platform.
- **LS-R06 Rebuildability:** State is fully rebuildable from the eventlog at
  any time.

### Pluggable boundaries

- **LS-R07 Platform-agnostic core:** The core engine has no platform
  dependencies; platform specifics live in adapters realizing a common
  contract.
- **LS-R08 Sync-provider agnosticism:** Sync backends implement a
  provider-neutral contract; multiple independent realizations are supported.
- **LS-R09 Framework agnosticism:** The store surface is usable without any
  UI framework; framework integrations are thin wrappers over it.
- **LS-R10 Read-model contract:** State realizations sit behind a common
  contract; SQLite is the primary realization, not the only permitted one.

### Transparency and developer experience

- **LS-R11 Typed schemas:** Events, state, and query results are fully typed
  from schema definitions.
- **LS-R12 Reactive queries:** Queries are observable; dependent computations
  and UI update automatically when state changes.
- **LS-R13 Inspectability:** The eventlog, state derivation, and sync status
  can be inspected during development via devtools.

### Performance

- **LS-R14 Interactive-grade reads:** The synchronous read path is fast
  enough for 120fps-class interactive apps.

### Product and intent identity

- **LS-R15 Single intent layer:** This VRS tree is the only always-current
  intent source; docs and RFC surfaces derive from it or feed into it and
  must not contradict it.
- **LS-R16 One product identity:** Users see one npm scope, one docs site,
  and one term system across both repositories.
