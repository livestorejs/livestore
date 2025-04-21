---
title: Reactivity system
sidebar:
  order: 5
---

LiveStore provides a Signals-like reactivity system which supports:
- Reactive SQL queries on top of SQLite state (`queryDb()`)
- Reactive computed values (`computed()`)
- Reactive state values (`makeRef()`)

Live query variables end on a `$` by convention (e.g. `todos$`).

### Reactive SQL queries

```ts
import { queryDb } from '@livestore/livestore'

const todos$ = queryDb(tables.todos.orderBy('createdAt', 'desc'))

// Or using callback syntax to depend on other queries
const todos$ = queryDb((get) => {
  const { showCompleted } = get(uiState$)
  return tables.todos.where(showCompleted ? { completed: true } : {})
})
```

### Computed values

```ts
import { computed } from '@livestore/livestore'

const showAllLabel$ = computed((get) => get(uiState$).showCompleted ? 'show completed' : 'show all')
```

### Signals

Signals are reactive state values that can be set and get.

```ts
import { signal } from '@livestore/livestore'

const now$ = signal(Date.now(), { label: 'now$' })

setInterval(() => {
  store.setSignal(now$, Date.now())
}, 1000)
```

## Further reading

- [Riffle](https://riffle.systems/essays/prelude/): Building data-centric apps with a reactive relational database
- [Adapton](http://adapton.org/) / [miniAdapton](https://arxiv.org/pdf/1609.05337)

## Related technologies

- [Signia](https://signia.tldraw.dev/): Signia is a minimal, fast, and scalable signals library for TypeScript developed by TLDraw.
