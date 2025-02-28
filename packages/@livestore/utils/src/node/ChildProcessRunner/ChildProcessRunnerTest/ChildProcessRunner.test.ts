// import * as WorkerThreads from 'node:worker_threads'
import * as ChildProcess from 'node:child_process'

import * as EffectWorker from '@effect/platform/Worker'
import { assert, it } from '@effect/vitest'
import { Chunk, Effect, Stream } from 'effect'

import * as ChildProcessWorker from '../ChildProcessWorker.js'
import type { WorkerMessage } from './schema.js'
import { GetPersonById, GetUserById, InitialMessage, Person, User } from './schema.js'

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
