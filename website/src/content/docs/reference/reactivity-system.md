---
title: Reactivity system
sidebar:
  order: 5
---

- LiveStore provides a Signals-like reactivity system which supports
  - Reactive SQL queries on top of SQLite (`queryDb()`)
	- Reactive computed values (`computed()`)
	- Reactive state values

## Examples

```ts
import { queryDb, computed } from '@livestore/livestore'
```

## Further reading

- [Adapton](http://adapton.org/) / [miniAdapton](https://arxiv.org/pdf/1609.05337)
