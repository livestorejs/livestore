---
title: Troubleshooting
description: Common issues in apps using LiveStore and possible solutions.
sidebar:
  order: 8
---

### Store / sync backend is stuck in a weird state

While hopefully rare in practice, it might still happen that a client or a sync backend is stuck in a weird/invalid state. Please report such cases as a [GitHub issue](https://github.com/livestorejs/livestore/issues).

To avoid being stuck, you can either:

- use a different `storeId`
- or reset the sync backend and local client for the given `storeId` 

## React related issues

### Rebase loop triggers repeated event emissions

Symptoms
- Logs repeatedly show messages like: `merge:pull:rebase: rollback` and the same local events being rolled back and replayed.

Why this happens
- LiveStore uses optimistic local commits and rebasing during sync. On pull, the client rolls back local events, applies the remote head, then replays local events — and only then refreshes reactive queries (transactional from the UI’s perspective).
- If your app emits events from a reactive effect based on read‑model changes (e.g., “when the latest item changes, emit X”), the effect runs after each completed rebase. Without a rebase‑safe guard, it can emit the same logical event repeatedly across rebases.
- Multiple windows/devices for the same user can also emit the same logical event at nearly the same time. Even if writes are idempotent, the extra local commits still cause additional rebases and effect re‑runs.

Circuit breaker fix (rebase‑safe)
- Implement a session‑local circuit breaker: track which logical actions you’ve already emitted in this session using an in‑memory set. This guard is not affected by rollback/replay, so it prevents re‑emitting across rebases.
- Avoid feedback loops: don’t use the same store state you’re writing as the primary trigger.

Example pattern (React)

```tsx
// Pseudocode – rebase‑safe circuit breaker for side‑effects
const circuitBreakerRef = useRef<Set<string>>(new Set())
const latest = useLatestItemFromStore() // derived read‑model state

React.useEffect(() => {
  if (!latest) return

  const key = latest.logicalId
  if (circuitBreakerRef.current.has(key)) return // session‑local guard (not rolled back)

  circuitBreakerRef.current.add(key) // open the breaker before emitting
  store.commit(events.someEvent({ id: deterministicIdFrom(latest), ... }))
}, [latest, store])
```

Checklist
- Use a deterministic id for the event when possible.
- Gate emission with a session‑local circuit breaker to avoid re‑emitting across rebases.
- Keep effect dependencies minimal; avoid depending on store state that you also update in the same effect.

Note on terminology
- “Circuit breaker” here refers to an app‑level guard that prevents repeated side‑effect emissions across rebases. It is distinct from the traditional network/service circuit‑breaker pattern (failure threshold/open/half‑open) but serves a similar purpose of preventing repeated work under specific conditions.

### Query doesn't update properly

If you notice the result of a `useQuery` hook is not updating properly, you might be missing some dependencies in the query's hash.

For example, the following query:

```ts
// Don't do this
const query$ = useQuery(queryDb(tables.issues.query.where({ id: issueId }).first()))
//                                                              ^^^^^^^ missing in deps

// Do this instead
const query$ = useQuery(queryDb(tables.issues.query.where({ id: issueId }).first(), { deps: [issueId] }))
```

## `node_modules` related issues

### `Cannot execute an Effect versioned ...`

If you're seeing an error like `RuntimeException: Cannot execute an Effect versioned 3.10.13 with a Runtime of version 3.10.12`, you likely have multiple versions of `effect` installed in your project.

As a first step you can try deleting `node_modules` and running `pnpm install` again.

If the issue persists, you can try to add `"resolutions": { "effect": "3.15.2" }` or [`pnpm.overrides`](https://pnpm.io/package_json#pnpmoverrides) to your `package.json` to force the correct version of `effect` to be used.

## Package management

- Please make sure you only have a single version of any given package in your project (incl. LiveStore and other packages like `react`, etc). Having multiple versions of the same package can lead to all kinds of issues and should be avoided. This is particularly important when using LiveStore in a monorepo.
- Setting `resolutions` in your root `package.json` or tools like [PNPM catalogs](https://pnpm.io/catalogs) or [Syncpack](https://github.com/JamieMason/syncpack) can help you manage this.
