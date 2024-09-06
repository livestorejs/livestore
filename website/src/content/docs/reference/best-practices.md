---
title: Best Practices
description: Best practices for using LiveStore
---

- It's usually recommend to **not distinguish** between app state vs app data but rather keep all state in LiveStore.
	- This means you'll rarely use `React.useState` when using LiveStore
- In some cases (such as text input/scroll position/resize events) it can make sense to keep a version of a state value outside of LiveStore with a reactive setter for React and a debounced setter for LiveStore to avoid excessive LiveStore mutations


## Queries

- For queries which could return many rows, it's recommended to paginate the results
  - Usually both via paginated/virtualized rendering as well as paginated queries
	- You'll get best query performance by using a `WHERE` clause over an indexed column combined with a `LIMIT` clause. Avoid `OFFSET` as it can be slow on large tables
- For very large/complex queries, it can also make sense to implement incremental view maintenance (IVM) for your queries
  - You can for example do this by have a separate table which is a materialized version of your query results which you update manually (and ideally incrementally) as the underlying data changes.
