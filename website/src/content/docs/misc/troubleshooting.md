---
title: Troubleshooting
description: Common issues in apps using LiveStore and possible solutions.
sidebar:
  order: 8
---

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

If the issue persists, you can try to add `"resolutions": { "effect": "3.12.1" }` or [`pnpm.overrides`](https://pnpm.io/package_json#pnpmoverrides) to your `package.json` to force the correct version of `effect` to be used.
