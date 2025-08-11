---
title: Effect
sidebar:
  order: 21
---

LiveStore itself is built on top of [Effect](https://effect.website) which is a powerful library to write production-grade TypeScript code. It's also possible (and recommended) to use Effect directly in your application code.

## Schema

LiveStore uses the [Effect Schema](https://effect.website/docs/schema/introduction/) library to define schemas for the following:

- Read model table column definitions
- Event event payloads definitions
- Query response types

For convenience, LiveStore re-exports the `Schema` module from the `effect` package, which is the same as if you'd import it via `import { Schema } from 'effect'` directly.

### Example

```ts
import { Schema } from '@livestore/livestore'

// which is equivalent to (if you have `effect` as a dependency)
import { Schema } from 'effect'
```

## `Equal` and `Hash` Traits

LiveStore's reactive primitives (`LiveQueryDef` and `SignalDef`) implement Effect's `Equal` and `Hash` traits, enabling efficient integration with Effect's data structures and collections.

## Effect Atom Integration

LiveStore integrates seamlessly with [Effect Atom](https://github.com/effect-atom/effect-atom) for reactive state management in React applications. This provides a powerful combination of Effect's functional programming capabilities with LiveStore's event sourcing and CQRS patterns.

Effect Atom is an external package developed by [Tim Smart](https://github.com/tim-smart) that provides a more Effect-idiomatic alternative to the `@livestore/react` package. While `@livestore/react` offers a straightforward React integration, Effect Atom leverages Effect API/patterns throughout, making it a natural choice for applications already using Effect.

### Installation

```bash
pnpm install @effect-atom/atom-livestore @effect-atom/atom-react
```

### Store Creation

Create a LiveStore-backed atom store with persistence and worker support:

```ts
// atoms.ts
import { schema } from './schema'
import { makePersistedAdapter } from '@livestore/adapter-web'
import { AtomLivestore } from '@effect-atom/atom-livestore'
import { unstable_batchedUpdates } from 'react-dom'

// Create a persistent adapter with OPFS storage
const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

// Create store atoms
export const {
  runtimeAtom,      // Access to Effect runtime
  commitAtom,       // Commit events to the store
  storeAtom,        // Access store with Effect
  storeAtomUnsafe,  // Direct store access when store is already loaded (synchronous)
  makeQueryAtom,    // Create query atoms with Effect
  makeQueryAtomUnsafe, // Create query atoms without Effect
} = AtomLivestore.make({
  schema,
  storeId: 'default',
  adapter,
  batchUpdates: unstable_batchedUpdates, // React batching for performance
})
```

### Defining Query Atoms

Create reactive query atoms that automatically update when the underlying data changes:

```ts
import { queryDb, sql } from '@livestore/livestore'
import { tables } from './schema'
import { makeQueryAtom } from './atoms'

// Simple query atom
export const usersAtom = makeQueryAtom(
  queryDb(tables.users.all())
)

// Query with SQL
export const activeUsersAtom = makeQueryAtom(
  queryDb({
    query: sql`SELECT * FROM users WHERE isActive = true ORDER BY name`,
    schema: User.array
  })
)

// Dynamic query based on other state
export const searchResultsAtom = makeQueryAtom(
  queryDb((get) => {
    const searchTerm = get(searchTermAtom)
    
    if (searchTerm.trim() === '') {
      return {
        query: sql`SELECT * FROM products ORDER BY createdAt DESC`,
        schema: Product.array
      }
    }
    
    return {
      query: sql`SELECT * FROM products WHERE name LIKE ? ORDER BY name`,
      schema: Product.array,
      bindValues: [`%${searchTerm}%`]
    }
  }, { label: 'searchResults' })
)
```

### Using Queries in React Components

Access query results in React components with the `useAtomValue` hook. When using `makeQueryAtom` (non-unsafe API), the result is wrapped in a Result type for proper loading and error handling:

```tsx
import { useAtomValue } from '@effect-atom/atom-react'
import { Result } from '@effect-atom/atom-react'
import { activeUsersAtom } from './queries'

function UserList() {
  const users = useAtomValue(activeUsersAtom)
  
  return Result.builder(users)
    .onInitial(() => <div>Loading users...</div>)
    .onSuccess((users) => (
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    ))
    .onError((error) => <div>Error: {error.message}</div>)
    .render()
}
```

### Integrating Effect Services

Combine Effect services with LiveStore operations using runtime atoms:

```ts
import { Effect } from 'effect'
import { useSetAtom } from '@effect-atom/atom-react'
import { runtimeAtom, storeAtomUnsafe } from './atoms'
import { events } from './schema'
import { MyService } from './services'

// Create an atom that uses Effect services
export const createItemAtom = runtimeAtom.fn<string>()(
  Effect.fn(function* (itemName, get) {
    // Access Effect services
    const service = yield* MyService
    
    // Perform service operations
    const processedData = yield* service.processItem(itemName)
    
    // Get the store and commit events
    const store = get(storeAtomUnsafe)
    if (store) {
      store.commit(events.itemCreated({
        id: crypto.randomUUID(),
        name: processedData.name,
        metadata: processedData.metadata
      }))
    }
  }, Effect.tapErrorCause(Effect.log))
)

// Use in a React component
function CreateItemButton() {
  const createItem = useSetAtom(createItemAtom)
  
  const handleClick = () => {
    createItem('New Item')
  }
  
  return <button onClick={handleClick}>Create Item</button>
}
```

### Advanced Patterns

#### Optimistic Updates

Combine local state with LiveStore for optimistic UI updates. When using `makeQueryAtomUnsafe`, the data is directly available:

```ts
// Using unsafe API for direct access
export const todosAtom = makeQueryAtomUnsafe(
  queryDb(tables.todos.all())
)

export const optimisticTodoAtom = atom((get) => {
  const todos = get(todosAtom) // Direct array, not wrapped in Result
  const pending = get(pendingTodosAtom)
  
  return [...todos, ...pending]
})
```

#### Derived State

Create computed atoms based on LiveStore queries. When using the non-unsafe API, handle the Result type:

```ts
export const todoStatsAtom = atom((get) => {
  const todos = get(todosAtom) // Assumes todosAtom uses makeQueryAtom
  
  return Result.map(todos, (todoList) => ({
    total: todoList.length,
    completed: todoList.filter(t => t.completed).length,
    pending: todoList.filter(t => !t.completed).length
  }))
})
```

#### Batch Operations

Perform multiple commits efficiently (commits are synchronous):

```ts
export const bulkUpdateAtom = runtimeAtom.fn<string[]>()(
  Effect.fn(function* (ids, get) {
    const store = get(storeAtomUnsafe)
    if (!store) return
    
    // Commit multiple events synchronously
    for (const id of ids) {
      store.commit(events.itemUpdated({ id, status: 'processed' }))
    }
  })
)
```

### Best Practices

1. **Use `makeQueryAtom` for queries**: This ensures proper Effect integration and error handling
2. **Leverage Effect services**: Integrate business logic through Effect services for better testability
3. **Handle loading states**: Use `Result.builder` pattern for consistent loading/error UI
4. **Batch React updates**: Always provide `batchUpdates` for better performance
5. **Label queries**: Add descriptive labels to queries for better debugging
6. **Type safety**: Let TypeScript infer types from schemas rather than manual annotations

### Real-World Example

For a comprehensive example of LiveStore with Effect Atom in action, check out [Cheffect](https://github.com/tim-smart/cheffect) - a recipe management application that demonstrates:
- Complete Effect service integration
- AI-powered recipe extraction using Effect services
- Complex query patterns with search and filtering
- Worker-based persistence with OPFS
- Production-ready error handling and logging
```
