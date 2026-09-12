# 0002 — Commit callbacks return complete event arrays

Status: accepted (2026-09-12, maintainer-approved follow-up to
[#1616](https://github.com/livestorejs/livestore/pull/1616#issuecomment-5622042810))

## Context

`store.commit` accepts events directly and supports a callback form for building
a conditional batch. PR #1616 fixed that callback by collecting events passed to
an emitter before materialization, while explicitly ignoring callback return
values. The follow-up review asked whether the API should instead support only
callbacks that return arrays, avoiding two ways to describe the same batch.

The callback does not run inside the SQLite transaction. LiveStore invokes it to
produce the complete event batch, then validates, encodes, and materializes that
batch after the callback returns. Queries made inside the callback therefore see
the pre-commit state.

[TypeScript permits a function returning any value](https://github.com/microsoft/TypeScript/wiki/FAQ#why-are-functions-returning-non-void-assignable-to-function-returning-void),
including a promise, to stand in for a `void`-returning callback. An emitter
callback typed as returning `void` consequently cannot enforce the documented
synchronous boundary or flag an accidentally returned event array.

## Options

- **A. Emitter callback:** Keep `store.commit((emit) => { emit(event) })` and
  ignore its return value. This makes imperative event collection concise, but
  resembles an active transaction even though no event is applied in the
  callback. Its `void` return type also accepts accidental return values and
  asynchronous callbacks.
- **B. Array-returning callback (chosen):** Use
  `store.commit(() => [event])`. The callback returns the complete batch as a
  value and its return type enforces the synchronous API in ordinary typed code.
- **C. No callback:** Require callers to build arrays outside `store.commit` and
  spread them into the direct event overload. This has the smallest API, but
  removes the existing scoped, lazy form for conditional batch construction.

## Decision

Keep the callback overload as a synchronous batch builder and require it to
return a `ReadonlyArray` of schema events. Do not pass it an emitter, accept a
single returned event, or support both callback styles. Direct event arguments
remain supported.

At runtime, reject a callback result that is not an array with a focused error.
Copy a valid returned array before it enters the commit pipeline. Exceptions
still propagate before materialization, and an empty array remains a no-op.

## Consequences

- The callback shape now mirrors the implementation: it describes data that
  LiveStore commits after the callback finishes rather than appearing to commit
  incrementally.
- Promises are not assignable to the callback's array return type, closing the
  common async footgun where emissions after an `await` would be lost.
- Array operations and helper functions compose directly into commit batches.
  Imperative builders can use a local array and return it.
- Existing emitter callbacks must migrate to array returns. Because the callback
  API changed during the same unreleased version as the #1616 fix, the existing
  changeset and unreleased changelog entry describe the final contract rather
  than recording the intermediate emitter design.
- A future API that exposes reads and writes inside a real transaction should be
  introduced separately instead of changing this batch-builder callback's
  semantics.
