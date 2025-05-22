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
