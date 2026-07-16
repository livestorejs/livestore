# Framework Integrations — Spec

This document specifies the integration contract and the shared toolkit
(`packages/@livestore/framework-toolkit`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Shared Toolkit

| Primitive | File | Purpose |
| --- | --- | --- |
| `normalizeQueryable` | `query.ts` | QueryBuilder → `queryDb` def; def/signal-def passthrough; live `LiveQuery` instance → `{ _tag: 'live-query' }` |
| `computeRcRefKey` | `query.ts` | Resource cache key `${storeId}_${clientId}_${sessionId}:def:${hash}` (or `:instance:${id}`) — scoping that prevents cross-store cache mixing |
| `createQueryResource` / `runInitialQuery` | `query.ts` | Builds the rc-ref + otel span per query; live-query instances get a synthetic `rc: Infinity` ref. `runInitialQuery` hardcodes `debugRefreshReason: 'react'` for all frameworks (code TODO) |
| Client-document helpers | `client-document.ts` | Table-shape validation + `removeUndefinedValues`; the LWW set path itself lives in the binding (see 01-react) |
| Stack info | `stack-info.ts` | Query provenance via a captured JS stack trace (temporarily raises `Error.stackTraceLimit`) |
| Testing utilities | `testing.ts` | TodoMVC fixture store over the in-memory adapter |

An integration composes these with its framework's reactivity: subscribe on
mount/first read, unsubscribe on disposal, resolve stores through the
registry (LS.SYS.INT-R03).

## Realizations

Full registry (in-repo + contrib, with conformance status):
[realizations.md](./realizations.md). In-repo children:
[01-react/](./01-react/spec.md) and [02-effect/](./02-effect/spec.md).

## Open Design Questions

- **LS.SYS.INT-DQ1 Contract conformance.** No shared conformance suite
  verifies LS.SYS.INT-R04/R05 across integrations (cf.
  `../09-verification/`).
