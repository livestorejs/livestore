# Framework Integrations — Requirements

Defines the contract for framework integrations: thin, stateless bindings
from the Store to a UI framework's idioms, sharing one toolkit. Refines the
framework-agnosticism requirement of the root ([LS-R09]).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`) and the Store
contract (`../05-store/`). Realizations:
[01-react/](./01-react/requirements.md) and
[02-effect/](./02-effect/requirements.md); Vue/Solid/Svelte integrations are
contrib-owned (stub pending LS-DQ2).

## Requirements

- **LS.SYS.INT-R01 Thin wrappers:** Integrations adapt Store primitives to
  framework idioms; they hold no data state of their own and add no query
  semantics. `refines: LS-R09`
- **LS.SYS.INT-R02 Shared toolkit:** Cross-framework logic — queryable
  normalization, client-document helpers, stack-info for query provenance —
  lives once in `framework-toolkit`, not per integration.
- **LS.SYS.INT-R03 Lifecycle ownership:** Integrations acquire and release
  stores through the store registry so store lifetime follows component/app
  lifetime without manual shutdown. `refines: LS.SYS.STORE-R07`
- **LS.SYS.INT-R04 Reactive parity:** Framework-rendered values reflect live
  query updates without stale reads or missed updates. `refines: LS-R12`
- **LS.SYS.INT-R05 Robust under framework semantics:** Integrations tolerate
  their framework's rendering model (e.g. React StrictMode double-invoke,
  concurrent rendering) without leaking or double-registering resources.
- **LS.SYS.INT-R06 Read seeds default:** The first read of a client document
  idempotently materializes its default value without triggering a refresh
  loop. Adopted 2026-07-16 (interview).
  `refines: LS.SYS.STATE.SQLITE-R03`
