import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { useEffect } from 'react'

import type { Todo } from './schema'
import { tables } from './schema'
import { addTodo, completeTodo, deleteTodo } from './schema/mutations.ts'

declare global {
  function prepareStore(data: Todo[]): void
  function runSimpleQuery(): ReadonlyArray<Todo>
  function runFilteredQuery(): ReadonlyArray<Todo>
  function runComplexQuery(): ReadonlyArray<Todo>

  function runSingleInsert(todo: Todo): void
  function runBatchUpdate(): Promise<number>
  function runLargeBatchOperation(): Promise<number>
  function measureQueryThroughput(
    durationMs: number,
  ): Promise<{ queriesPerSecond: number; totalQueries: number; durationMs: number }>
  function measureMutationThroughput(
    durationMs: number,
  ): Promise<{ mutationsPerSecond: number; totalMutations: number; durationMs: number }>
  function measureMainThreadBlocking(operation: () => void): Promise<number>
  function runMemoryProfileTest(): Promise<{ stage: string; memory: number }[]>
}

const App = () => {
  const { store } = useStore()

  // Initialize the test environment
  useEffect(() => {
    globalThis.prepareStore = async (data: Todo[]) => {
      for (const todo of data) {
        store.mutate(addTodo({ id: todo.id, text: todo.text }))
        if (todo.completed) {
          store.mutate(completeTodo({ id: todo.id }))
        }
        if (todo.deleted) {
          store.mutate(deleteTodo({ id: todo.id, deleted: todo.deleted }))
        }
      }
    }

    globalThis.runSimpleQuery = () => {
      const query = queryDb(tables.todos.query.select())
      return store.query(query)
    }

    globalThis.runFilteredQuery = () => {
      return store.query(queryDb(tables.todos.query.select().where({ completed: true })))
    }

    globalThis.runComplexQuery = () => {
      return store.query(
        queryDb(tables.todos.query.where({ completed: true, deleted: null }).orderBy('text', 'desc').limit(100)),
      )
    }

    globalThis.runSingleInsert = (todo: Todo) => {
      return store.mutate(addTodo({ id: todo.id, text: todo.text }))
    }

    globalThis.runBatchUpdate = async () => {
      const todos = store.query(queryDb(tables.todos.query.select().where({ completed: false }).limit(50)))

      for (const todo of todos) {
        store.mutate(completeTodo({ id: todo.id }))
      }

      return todos.length
    }

    globalThis.runLargeBatchOperation = async () => {
      const todos = store.query(queryDb(tables.todos.query.select().limit(500)))

      const now = Date.now()
      for (const todo of todos) {
        store.mutate(deleteTodo({ id: todo.id, deleted: now }))
      }

      return todos.length
    }

    globalThis.measureQueryThroughput = async (durationMs: number) => {
      const startTime = Date.now()
      let queryCount = 0

      while (Date.now() - startTime < durationMs) {
        globalThis.runSimpleQuery()
        queryCount++
      }

      const actualDuration = Date.now() - startTime
      return {
        queriesPerSecond: (queryCount / actualDuration) * 1000,
        totalQueries: queryCount,
        durationMs: actualDuration,
      }
    }

    globalThis.measureMutationThroughput = async (durationMs: number) => {
      const startTime = Date.now()
      let mutationCount = 0

      while (Date.now() - startTime < durationMs) {
        store.mutate(
          addTodo({
            id: `perf-test-${mutationCount}-${Date.now()}`,
            text: `Performance test todo ${mutationCount}`,
          }),
        )
        mutationCount++
      }

      const actualDuration = Date.now() - startTime
      return {
        mutationsPerSecond: (mutationCount / actualDuration) * 1000,
        totalMutations: mutationCount,
        durationMs: actualDuration,
      }
    }

    // Measure main thread blocking
    // globalThis.measureMainThreadBlocking = async (operation) => {
    //   // Create a series of timestamps before operation
    //   const timestamps: DOMHighResTimeStamp[] = []
    //   const startTime = performance.now()
    //
    //   // Start a separate "thread" to record timestamps
    //   const recordingPromise = new Promise<void>((resolve) => {
    //     const interval = setInterval(() => {
    //       timestamps.push(performance.now())
    //       if (performance.now() - startTime > 5000) {
    //         clearInterval(interval)
    //         resolve()
    //       }
    //     }, 1)
    //   })
    //
    //   // Run the operation
    //   operation()
    //
    //   // Wait for recording to finish
    //   await recordingPromise
    //
    //   // Calculate max gap between timestamps
    //   let maxGap = 0
    //   for (let i = 1; i < timestamps.length; i++) {
    //     const gap = timestamps[i] - timestamps[i - 1]
    //     maxGap = Math.max(maxGap, gap)
    //   }
    //
    //   return maxGap
    // }

    globalThis.runMemoryProfileTest = async () => {
      if (!('memory' in performance)) {
        throw new Error('Performance.memory is not supported in this environment.')
      }

      const getMemory = () => {
        // @ts-expect-error `Performance.memory` is deprecated, but we still use it until `Performance.measureUserAgentSpecificMemory()` becomes available.
        const memory: { usedJSHeapSize: number } = performance.memory
        return memory.usedJSHeapSize / (1024 * 1024)
      }

      const profile = []

      profile.push({ stage: 'baseline', memory: getMemory() })

      for (let i = 0; i < 100; i++) {
        globalThis.runSimpleQuery()
      }
      profile.push({ stage: 'after_100_queries', memory: getMemory() })

      for (let i = 0; i < 100; i++) {
        globalThis.runSingleInsert({
          id: `memory-test-${i}-${Date.now()}`,
          text: `Memory test todo ${i}`,
          completed: false,
          deleted: null,
        })
      }
      profile.push({ stage: 'after_100_mutations', memory: getMemory() })

      // After complex operations
      await globalThis.runLargeBatchOperation()
      profile.push({ stage: 'after_batch_operation', memory: getMemory() })

      return profile
    }
  }, [store])

  return (
    <div className="test-app">
      <h1>LiveStore Performance Test App</h1>
    </div>
  )
}
export default App
