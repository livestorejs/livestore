# Examples — Requirements

Role: owns the example apps (`examples/`) — a learning surface that doubles
as integration-test fixtures for the shipping packages.

## Context

Builds on [../requirements.md](../requirements.md). Examples are exercised by
`mono examples <run|deploy|test>` and referenced from the docs site
(`docs/src/content/docs/examples/`). Verification semantics belong to
`02-system/09-verification/`.

## Requirements

- **LS.DOCS.EX-R01 Runnable standalone:** Every example runs from a fresh
  clone with the project's standard dev commands, without private
  infrastructure.
- **LS.DOCS.EX-R02 Integration fixtures:** Examples are executed in CI
  (`mono examples test`); an example that breaks against current packages
  fails CI as a required gate. Currently violated — optional since #1391
  except the todomvc E2E (see
  [../.delta/DELTA-001-docs-gates-optional.md](../.delta/DELTA-001-docs-gates-optional.md)).
  `refines: LS.DOCS-R04`
- **LS.DOCS.EX-R03 Current APIs:** Examples use the current shipping APIs;
  changing a public API includes updating affected examples in the same
  change.
- **LS.DOCS.EX-R04 Deployed and reachable:** Examples deploy per branch tier
  (dev/preview/prod) with stable public URLs so users can try them without
  local setup.
