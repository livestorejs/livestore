import * as ChildProcess from 'node:child_process'

import * as EffectWorker from '@effect/platform/Worker'
import { assert, describe, it } from '@effect/vitest'
import { Chunk, Effect, Exit, Fiber, Scope, Stream } from 'effect'

import * as ChildProcessWorker from '../ChildProcessWorker.ts'
import type { WorkerMessage } from './schema.ts'
import { GetPersonById, GetUserById, InitialMessage, Person, StartStubbornWorker, User } from './schema.ts'

const WorkerLive = ChildProcessWorker.layer(() =>
  ChildProcess.fork(
    new URL('../../../../dist/node/ChildProcessRunner/ChildProcessRunnerTest/serializedWorker.js', import.meta.url),
  ),
)

// const WorkerLive = NodeWorker.layer(
//   () =>
//     new WorkerThreads.Worker(
//       new URL('../../../../dist/node/ChildProcessRunner/ChildProcessRunnerTest/serializedWorker.js', import.meta.url),
//     ),
// )

describe('ChildProcessRunner', { timeout: 10_000 }, () => {
  it('Serialized', () =>
    Effect.gen(function* () {
      const pool = yield* EffectWorker.makePoolSerialized({ size: 1 })
      const people = yield* pool.execute(new GetPersonById({ id: 123 })).pipe(Stream.runCollect)
      assert.deepStrictEqual(Chunk.toReadonlyArray(people), [
        new Person({ id: 123, name: 'test', data: new Uint8Array([1, 2, 3]) }),
        new Person({ id: 123, name: 'ing', data: new Uint8Array([4, 5, 6]) }),
      ])
    }).pipe(Effect.scoped, Effect.provide(WorkerLive), Effect.runPromise))

  it('Serialized with initialMessage', () =>
    Effect.gen(function* () {
      const pool = yield* EffectWorker.makePoolSerialized<WorkerMessage>({
        size: 1,
        initialMessage: () => new InitialMessage({ name: 'custom', data: new Uint8Array([1, 2, 3]) }),
      })

      let user = yield* pool.executeEffect(new GetUserById({ id: 123 }))
      user = yield* pool.executeEffect(new GetUserById({ id: 123 }))
      assert.deepStrictEqual(user, new User({ id: 123, name: 'custom' }))
      const people = yield* pool.execute(new GetPersonById({ id: 123 })).pipe(Stream.runCollect)
      assert.deepStrictEqual(Chunk.toReadonlyArray(people), [
        new Person({ id: 123, name: 'test', data: new Uint8Array([1, 2, 3]) }),
        new Person({ id: 123, name: 'ing', data: new Uint8Array([4, 5, 6]) }),
      ])
    }).pipe(Effect.scoped, Effect.provide(WorkerLive), Effect.runPromise))

  describe('Process Cleanup', { timeout: 15_000 }, () => {
    const isProcessRunning = (pid: number) => {
      try {
        process.kill(pid, 0) // Signal 0 checks if process exists
        return true
      } catch {
        return false
      }
    }

    it('should clean up child processes when Effect is interrupted', () =>
      Effect.gen(function* () {
        let workerPid: number | undefined

        const testEffect = Effect.gen(function* () {
          const pool = yield* EffectWorker.makePoolSerialized<WorkerMessage>({
            size: 1,
            initialMessage: () => new InitialMessage({ name: 'test', data: new Uint8Array([1, 2, 3]) }),
          })
          const result = yield* pool.executeEffect(new StartStubbornWorker({ blockDuration: 30_000 }))
          workerPid = result.pid

          // Verify the worker process is running
          assert.strictEqual(isProcessRunning(workerPid), true, 'Worker process should be running')

          // Start a long-running operation that we'll interrupt
          yield* Effect.sleep('60 seconds')
        }).pipe(Effect.scoped, Effect.provide(WorkerLive))

        // Run the test effect but interrupt it after 2 seconds
        const fiber = yield* Effect.fork(testEffect)
        yield* Effect.sleep('2 seconds')
        yield* Fiber.interrupt(fiber)

        // Wait a moment for cleanup to complete
        yield* Effect.sleep('1 second')

        // Verify the child process was cleaned up
        if (workerPid) {
          assert.strictEqual(
            isProcessRunning(workerPid),
            false,
            `Worker process ${workerPid} should be terminated after Effect interruption`,
          )
        } else {
          assert.fail('Worker PID was not captured')
        }
      }).pipe(Effect.runPromise))

    it('should clean up child processes when scope is closed abruptly', () =>
      Effect.gen(function* () {
        let workerPid: number | undefined

        // Create a scope that we can close manually
        const scope = yield* Scope.make()

        try {
          const pool = yield* EffectWorker.makePoolSerialized<WorkerMessage>({
            size: 1,
            initialMessage: () => new InitialMessage({ name: 'test', data: new Uint8Array([1, 2, 3]) }),
          }).pipe(Scope.extend(scope), Effect.provide(WorkerLive))

          const result = yield* pool.executeEffect(new StartStubbornWorker({ blockDuration: 30_000 }))
          workerPid = result.pid

          // Verify the worker is running
          assert.strictEqual(isProcessRunning(workerPid!), true, 'Worker process should be running')
        } finally {
          // Abruptly close the scope (simulating test abortion)
          yield* Scope.close(scope, Exit.void)
        }

        // Wait for cleanup
        yield* Effect.sleep('1 second')

        // This should pass but will initially fail due to zombie process issue
        if (workerPid) {
          assert.strictEqual(
            isProcessRunning(workerPid),
            false,
            `Worker process ${workerPid} should be terminated after scope closure`,
          )
        } else {
          assert.fail('Worker PID was not captured')
        }
      }).pipe(Effect.runPromise))

    it('should clean up child processes when parent receives SIGINT', () =>
      Effect.gen(function* () {
        let workerPid: number | undefined

        const pool = yield* EffectWorker.makePoolSerialized<WorkerMessage>({
          size: 1,
          initialMessage: () => new InitialMessage({ name: 'test', data: new Uint8Array([1, 2, 3]) }),
        })

        const result = yield* pool.executeEffect(new StartStubbornWorker({ blockDuration: 60_000 }))
        workerPid = result.pid

        // Verify the worker is running
        assert.strictEqual(isProcessRunning(workerPid), true, 'Worker process should be running')

        // Simulate SIGINT being sent to current process (like Ctrl+C in vitest)
        // This should trigger cleanup of child processes
        yield* Effect.async<void>((resume) => {
          // Store current listeners before we manipulate them
          const currentSIGINTListeners = process.listeners('SIGINT').slice()

          // Set up our test handler
          const testHandler = () => {
            // Emit SIGINT to all current listeners to trigger cleanup
            currentSIGINTListeners.forEach((listener) => {
              try {
                ;(listener as Function)()
              } catch {
                // Ignore errors
              }
            })
            resume(Effect.void)
          }

          // Remove all current SIGINT listeners and add our test handler
          process.removeAllListeners('SIGINT')
          process.once('SIGINT', testHandler)

          // Send SIGINT after a short delay
          setTimeout(() => {
            process.kill(process.pid, 'SIGINT')
          }, 1000)
        })

        // Wait for cleanup to complete
        yield* Effect.sleep('2 seconds')

        // This test should initially fail - child process will still be running
        if (workerPid) {
          assert.strictEqual(
            isProcessRunning(workerPid),
            false,
            `Worker process ${workerPid} should be terminated after SIGINT`,
          )
        } else {
          assert.fail('Worker PID was not captured')
        }
      }).pipe(Effect.scoped, Effect.provide(WorkerLive), Effect.runPromise))

    it('should clean up multiple concurrent child processes', () =>
      Effect.gen(function* () {
        let workerPids: number[] = []

        const testEffect = Effect.gen(function* () {
          const pool = yield* EffectWorker.makePoolSerialized<WorkerMessage>({
            size: 3, // Multiple workers
            initialMessage: () => new InitialMessage({ name: 'test', data: new Uint8Array([1, 2, 3]) }),
          })

          // Start multiple stubborn workers
          const workers = yield* Effect.all(
            [
              pool.executeEffect(new StartStubbornWorker({ blockDuration: 30_000 })),
              pool.executeEffect(new StartStubbornWorker({ blockDuration: 30_000 })),
              pool.executeEffect(new StartStubbornWorker({ blockDuration: 30_000 })),
            ],
            { concurrency: 'unbounded' },
          )

          workerPids = workers.map((w) => w.pid)

          // Verify all workers are running
          for (const pid of workerPids) {
            assert.strictEqual(isProcessRunning(pid), true, `Worker process ${pid} should be running`)
          }

          yield* Effect.sleep('30 seconds') // Keep running until interrupted
        }).pipe(Effect.scoped, Effect.provide(WorkerLive))

        // Run with timeout to force termination
        const fiber = yield* Effect.fork(testEffect)
        yield* Effect.sleep('2 seconds')
        yield* Fiber.interrupt(fiber)

        // Wait for cleanup
        yield* Effect.sleep('2 seconds')

        // All worker processes should be cleaned up
        for (const pid of workerPids) {
          assert.strictEqual(
            isProcessRunning(pid),
            false,
            `Worker process ${pid} should be terminated after pool cleanup`,
          )
        }
      }).pipe(Effect.runPromise))

    it('should handle direct ChildProcess.fork cleanup (node-sync pattern)', () =>
      Effect.gen(function* () {
        let childPid: number | undefined

        // This mimics the exact pattern used in node-sync tests
        const nodeChildProcess = ChildProcess.fork(
          new URL(
            '../../../../dist/node/ChildProcessRunner/ChildProcessRunnerTest/serializedWorker.js',
            import.meta.url,
          ),
          ['test-client'],
        )

        childPid = nodeChildProcess.pid

        const testEffect = Effect.gen(function* () {
          const worker = yield* EffectWorker.makePoolSerialized<WorkerMessage>({
            size: 1,
            concurrency: 100,
            initialMessage: () => new InitialMessage({ name: 'test', data: new Uint8Array([1, 2, 3]) }),
          }).pipe(Effect.provide(ChildProcessWorker.layer(() => nodeChildProcess)))

          // Start stubborn worker
          yield* worker.executeEffect(new StartStubbornWorker({ blockDuration: 60_000 }))

          // Verify process is running
          if (childPid) {
            assert.strictEqual(isProcessRunning(childPid), true, 'Child process should be running')
          }

          // Keep running until interrupted
          yield* Effect.sleep('30 seconds')
        }).pipe(Effect.scoped)

        // Simulate the exact abortion pattern from node-sync
        const fiber = yield* Effect.fork(testEffect)
        yield* Effect.sleep('2 seconds')

        // Force kill the fiber without proper cleanup (simulates Ctrl+C)
        yield* Fiber.interrupt(fiber)

        // Wait for cleanup
        yield* Effect.sleep('3 seconds')

        // This test should initially fail - demonstrating the zombie process issue
        if (childPid) {
          assert.strictEqual(
            isProcessRunning(childPid),
            false,
            `Child process ${childPid} should be terminated after forced interruption`,
          )
        } else {
          assert.fail('Child PID was not captured')
        }
      }).pipe(Effect.runPromise))
  })
})
