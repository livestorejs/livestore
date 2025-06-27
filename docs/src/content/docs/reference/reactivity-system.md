---
title: Reactivity System
sidebar:
  order: 2
---

LiveStore has a high-performance, fine-grained reactivity system built in which is similar to Signals (e.g. in [SolidJS](https://docs.solidjs.com/concepts/signals)).

## Defining reactive state

LiveStore provides 3 types of reactive state:
- Reactive SQL queries on top of SQLite state (`queryDb()`)
- Reactive state values (`signal()`)
- Reactive computed values (`computed()`)

Reactive state variables end on a `$` by convention (e.g. `todos$`). The `label` option is optional but can be used to identify the reactive state variable in the devtools.

### Reactive SQL queries

```ts
import { queryDb } from '@livestore/livestore'

const todos$ = queryDb(tables.todos.orderBy('createdAt', 'desc'), { label: 'todos$' })

// Or using callback syntax to depend on other queries
const todos$ = queryDb((get) => {
  const { showCompleted } = get(uiState$)
  return tables.todos.where(showCompleted ? { completed: true } : {})
}, { label: 'todos$' })
```

### Signals

Signals are reactive state values that can be set and get. This can be useful for state that is not materialized from events into SQLite tables.

```ts
import { signal } from '@livestore/livestore'

const now$ = signal(Date.now(), { label: 'now$' })

setInterval(() => {
  store.setSignal(now$, Date.now())
}, 1000)

// Counter example
const num$ = signal(0, { label: 'num$' })
const increment = () => store.setSignal(num$, (prev) => prev + 1)

increment()
increment()

console.log(store.query(num$)) // 2
```

### Computed values

```ts
import { computed } from '@livestore/livestore'

const num$ = signal(0, { label: 'num$' })
const duplicated$ = computed((get) => get(num$) * 2, { label: 'duplicated$' })
```

## Accessing reactive state

Reactive state is always bound to a `Store` instance. You can access the current value of reactive state the following ways:

### Using the `Store` instance

```ts
// One-off query
const count = store.query(count$)

// By subscribing to the reactive state value
const unsub = count$.subscribe((count) => {
  console.log(count)
})
```

### Via framework integrations

#### React

```ts
import { useQuery } from '@livestore/react'

const MyComponent = () => {
  const value = useQuery(state$)

  return <div>{value}</div>
}
```

#### Solid

```ts
import { query } from '@livestore/solid'

const MyComponent = () => {
  const value = query(state$)

  return <div>{value}</div>
}
```

### Reacting to changing variables passed to queries

If your query depends on a variable passed in by the component, use the deps array to react to changes in this variable.

```ts
const todos$ = ({ showCompleted } ) => queryDb((get) => {
  return tables.todos.where(showCompleted ? { completed: true } : {})
}, {
  label: 'todos$',
  deps: [showCompleted] // 👈 add to deps array
})

const MyComponent = ({ showCompleted }) => {
  const todos = store.useQuery(todos$({ showCompleted }))

  return <div>{todos.length} Done</div>
}

``` 

## Further reading

- [Riffle](https://riffle.systems/essays/prelude/): Building data-centric apps with a reactive relational database
- [Adapton](http://adapton.org/) / [miniAdapton](https://arxiv.org/pdf/1609.05337)

## Related technologies

- [Signia](https://signia.tldraw.dev/): Signia is a minimal, fast, and scalable signals library for TypeScript developed by TLDraw.
