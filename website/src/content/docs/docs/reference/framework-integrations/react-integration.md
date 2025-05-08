---
title: React integration for LiveStore
sidebar:
  label: React
description: How to integrate LiveStore with React.
---

While LiveStore is framework agnostic, the `@livestore/react` package provides a first-class integration with React.

## Features

- High performance
- Fine-grained reactivity (using LiveStore's signals-based reactivity system)
- Instant, synchronous query results (without the need for `useEffect` and `isLoading` checks)
- Transactional state transitions (via `batchUpdates`)
- Also supports Expo / React Native via `@livestore/adapter-expo`

## API

### `LiveStoreProvider`

In order to use LiveStore with React, you need to wrap your application in a `LiveStoreProvider`.

```tsx
import { LiveStoreProvider } from '@livestore/react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'

const Root = () => {
  return (
    <LiveStoreProvider schema={schema} adapter={adapter} batchUpdates={batchUpdates}>
      <App />
    </LiveStoreProvider>
  )
}
```

### useStore

```tsx
import { useStore } from '@livestore/react'

const MyComponent = () => {
  const { store } = useStore()

  React.useEffect(() => {
    store.commit(tables.todos.insert({ id: '1', text: 'Hello, world!' }))
  }, [])

  return <div>...</div>
}
```

### useQuery

```tsx
import { useStore } from '@livestore/react'

const query$ = tables.todos.query.where({ completed: true }).orderBy('createdAt', 'desc')

const CompletedTodos = () => {
  const { store } = useStore()
  const todos = store.useQuery(query$)

  return <div>{todos.map((todo) => <div key={todo.id}>{todo.text}</div>)}</div>
}
```

### useClientDocument

```tsx
import { useStore } from '@livestore/react'

const TodoItem = ({ id }: { id: string }) => {
  const { store } = useStore()
  const [todo, updateTodo] = store.useClientDocument(tables.todos, id)

  return <div onClick={() => updateTodo({ text: 'Hello, world!' })}>{todo.text}</div>
}
```

## Usage with ...

### Vite

LiveStore works with Vite out of the box.

### Tanstack Start

LiveStore works with Tanstack Start out of the box.

### Expo / React Native

LiveStore has a first-class integration with Expo / React Native via `@livestore/adapter-expo`.

### Next.js

Given various Next.js limitations, LiveStore doesn't yet work with Next.js out of the box.

## Technical notes

- `@livestore/react` uses `React.useState` under the hood for `useQuery` / `useClientDocument` to bind LiveStore's reactivity to React's reactivity. Some libraries are using `React.useExternalSyncStore` for similar purposes but using `React.useState` in this case is more efficient and all that's needed for LiveStore.
- `@livestore/react` supports React Strict Mode.