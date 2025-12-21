import { Effect } from 'effect'
import { TodoStore } from './make-store-context.ts'
import { storeEvents, storeTables } from './schema.ts'

// ---cut---
// Access the store in Effect code with full type safety
const _todoService = Effect.gen(function* () {
  // Yield the store directly (it's a Context.Tag)
  const { store } = yield* TodoStore

  // Query with autocomplete for tables
  const todos = store.query(storeTables.todos.select())

  // Commit events
  store.commit(storeEvents.todoCreated({ id: '1', text: 'Buy milk' }))

  return todos
})

// Or use static accessors for a more functional style
const _todoServiceAlt = Effect.gen(function* () {
  // Query using static accessor
  const todos = yield* TodoStore.query(storeTables.todos.select())

  // Commit using static accessor
  yield* TodoStore.commit(storeEvents.todoCreated({ id: '1', text: 'Buy milk' }))

  return todos
})
