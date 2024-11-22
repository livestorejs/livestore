---
title: Troubleshooting
description: Common issues in apps using LiveStore and possible solutions.
---

## Leaking queries

If you notice your app getting slower over time, leaking memory or even crashing, it's possible that you have queries which are not being destroyed once no longer needed.

A common scenario for this looks like the following:

```ts
const query$ = useQuery(query(`SELECT * FROM issues where id = '${issueId}'`))
```

This will create a new query every time the component using it is re-rendered but never disposes of the previous query. To fix this, it's recommended to use `useScopedQuery` instead:

```ts
const query$ = useScopedQuery(() => query(`SELECT * FROM issues where id = '${issueId}'`), [issueId])
```

## `node_modules` related issues

### `Cannot execute an Effect versioned ...`

If you're seeing an error like `RuntimeException: Cannot execute an Effect versioned 3.10.13 with a Runtime of version 3.10.12`, you likely have multiple versions of `effect` installed in your project.

As a first step you can try deleting `node_modules` and running `pnpm install` again.

If the issue persists, you can try to add `"resolutions": { "effect": "___VERSION___" }` or [`pnpm.overrides`](https://pnpm.io/package_json#pnpmoverrides) to your `package.json` to force the correct version of `effect` to be used.
