---
title: Best Practices
description: Best practices for using LiveStore
sidebar:
  order: 6
---

- It's usually recommend to **not distinguish** between app state vs app data but rather keep all state in LiveStore.
	- This means you'll rarely use `React.useState` when using LiveStore
- In some cases for "fast changing values" it can make sense to keep a version of a state value outside of LiveStore with a reactive setter for React and a debounced setter for LiveStore to avoid excessive LiveStore mutations. Cases where this can make sense can include:
  - Text input / rich text editing
  - Scroll position tracking, resize events, move/drag events
  - ...

## Web adapter

- It's recommended to develop in an incognito window to avoid issues with persistent storage (e.g. OPFS).


## SQL Queries

- Query results should be treated as immutable/read-only
- For queries which could return many rows, it's recommended to paginate the results
  - Usually both via paginated/virtualized rendering as well as paginated queries
	- You'll get best query performance by using a `WHERE` clause over an indexed column combined with a `LIMIT` clause. Avoid `OFFSET` as it can be slow on large tables
- For very large/complex queries, it can also make sense to implement incremental view maintenance (IVM) for your queries
  - You can for example do this by have a separate table which is a materialized version of your query results which you update manually (and ideally incrementally) as the underlying data changes.

## File structure

- While there are no strict requirements/conventions for how to structure your project (files, folders, etc), a common pattern is to have a `src/livestore` folder which contains all the LiveStore related code.
  ```
  src/
    livestore/
      index.ts # re-exports everything
      schema.ts # schema definitions
      queries.ts # query definitions
      mutations.ts # mutation definitions
      ...
    ...
  ```

## Package management

- Please make sure you only have a single version of any given package in your project (incl. LiveStore and other packages like `react`, `effect`, etc). Having multiple versions of the same package can lead to all kinds of issues and should be avoided. This is particularly important when using LiveStore in a monorepo.
- Setting `resolutions` in your root `package.json` or tools like [PNPM catalogs](https://pnpm.io/catalogs) or [Syncpack](https://github.com/JamieMason/syncpack) can help you manage this.