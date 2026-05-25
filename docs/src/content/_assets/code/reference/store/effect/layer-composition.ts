import { Context, Effect, Layer } from 'effect'

import { TodoStore, TodoStoreLayer } from './make-store-context.ts'
import { storeEvents } from './schema.ts'

// ---cut---
// Define services that depend on the store
class TodoService extends Context.Service<TodoService>()('TodoService', {
  make: Effect.gen(function* () {
    const { store } = yield* TodoStore

    const createTodo = (id: string, text: string) =>
      Effect.sync(() => store.commit(storeEvents.todoCreated({ id, text })))

    const completeTodo = (id: string) => Effect.sync(() => store.commit(storeEvents.todoCompleted({ id })))

    return { createTodo, completeTodo } as const
  }),
}) {}

// Compose everything into a main layer
const TodoServiceLayer = Layer.effect(TodoService)(TodoService.make)
const MainLayer = TodoServiceLayer.pipe(Layer.provideMerge(TodoStoreLayer))

// Use in your application
const program = Effect.gen(function* () {
  const todoService = yield* TodoService
  yield* todoService.createTodo('1', 'Learn Effect')
  yield* todoService.completeTodo('1')
})

// Provide MainLayer when running (OtelTracer is also required)
void program.pipe(Effect.provide(MainLayer))
