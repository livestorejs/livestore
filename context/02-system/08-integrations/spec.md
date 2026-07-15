# Framework Integrations — Spec

This document specifies the integration contract and the shared toolkit
(`packages/@livestore/framework-toolkit`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Shared Toolkit

| Primitive | File | Purpose |
| --- | --- | --- |
| `normalizeQueryable` | `query.ts` | QueryBuilder / LiveQueryDef / LiveQuery → one internal shape |
| Client-document helpers | `client-document.ts` | Get/set over client documents with LWW semantics |
| Stack info | `stack-info.ts` | Query provenance for devtools/debugging |
| Testing utilities | `testing.ts` | Integration test scaffolding |

An integration composes these with its framework's reactivity: subscribe on
mount/first read, unsubscribe on disposal, resolve stores through the
registry (LS.SYS.INT-R03).

## Realizations

| Framework | Node | Status |
| --- | --- | --- |
| React | [01-react/](./01-react/spec.md) | in-repo |
| Vue, Solid, Svelte | contrib | stub pending LS-DQ2 |

## Open Design Questions

- **LS.SYS.INT-DQ1 Contract conformance.** No shared conformance suite
  verifies LS.SYS.INT-R04/R05 across integrations (cf.
  `../09-verification/`).
