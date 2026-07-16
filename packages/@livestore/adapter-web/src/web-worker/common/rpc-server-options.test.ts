import { expect, test } from 'vitest'

import { MaterializeError, SqliteError } from '@livestore/common'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Rpc,
  RpcClient,
  RpcGroup,
  RpcServer,
  Schema,
} from '@livestore/utils/effect'

import { requestScopedCauseRpcServerOptions } from './rpc-server-options.ts'
import { LeaderWorkerInnerPushToLeader } from './worker-schema.ts'

class Push extends Rpc.make('Push', {
  payload: { mode: Schema.Literals(['pure', 'mixed']) },
  success: Schema.Void,
  error: MaterializeError,
}) {}

class Ping extends Rpc.make('Ping', { success: Schema.Void }) {}

class TestRpcs extends RpcGroup.make(Push, Ping) {}
type TestRpc = RpcGroup.Rpcs<typeof TestRpcs>

const materializeFailure = MaterializeError.make({
  cause: SqliteError.make({ cause: new Error('materialization failed') }),
})
const companionDefect = new Error('companion defect')
const mixedCause = Cause.fromReasons([Cause.makeFailReason(materializeFailure), Cause.makeDieReason(companionDefect)])

const expectMaterializeCause = (exit: Exit.Exit<void, MaterializeError>, expectedMixed: boolean) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit) === false) return

  const failures = exit.cause.reasons.filter(Cause.isFailReason)
  const defects = exit.cause.reasons.filter(Cause.isDieReason)
  expect(failures.map((reason) => reason.error._tag)).toEqual(['MaterializeError'])
  expect(defects.map((reason) => (reason.defect as Error).message)).toEqual(
    expectedMixed === true ? ['companion defect'] : [],
  )
}

const makeClient = Effect.fnUntraced(function* (handlers: {
  readonly Push: (payload: typeof Push.payloadSchema.Type) => Effect.Effect<void, MaterializeError>
  readonly Ping: () => Effect.Effect<void>
}) {
  // oxlint-disable-next-line prefer-const -- the server callback closes over the client initialized immediately below
  let client!: Effect.Success<ReturnType<typeof RpcClient.makeNoSerialization<TestRpc, never>>>
  const server = yield* RpcServer.makeNoSerialization(TestRpcs, {
    ...requestScopedCauseRpcServerOptions,
    onFromServer: (response) => client.write(response),
  }).pipe(Effect.provide(TestRpcs.toLayer(handlers)))
  client = yield* RpcClient.makeNoSerialization(TestRpcs, {
    supportsAck: true,
    onFromClient: ({ message }) => server.write(0, message),
  })
  return client.client
})

const runRequestRoutingProof = (hops: 1 | 2) =>
  Effect.scoped(
    Effect.gen(function* () {
      const releasePing = yield* Deferred.make<void>()
      const innerClient = yield* makeClient({
        Push: ({ mode }) => (mode === 'pure' ? Effect.fail(materializeFailure) : Effect.failCause(mixedCause)),
        Ping: () => Deferred.await(releasePing),
      })
      const client =
        hops === 1
          ? innerClient
          : yield* makeClient({
              Push: (payload) => innerClient.Push(payload),
              Ping: () => innerClient.Ping(undefined),
            })

      const pingFiber = yield* client.Ping(undefined).pipe(Effect.forkChild)
      expectMaterializeCause(yield* client.Push({ mode: 'pure' }).pipe(Effect.exit), false)
      expectMaterializeCause(yield* client.Push({ mode: 'mixed' }).pipe(Effect.exit), true)

      // A handler defect belongs to its request and must not poison unrelated in-flight requests on either hop.
      expect(pingFiber.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releasePing, undefined)
      expect(Exit.isSuccess(yield* Fiber.await(pingFiber))).toBe(true)
    }),
  )

test('keeps pure and mixed materialization causes request-scoped across one RPC hop', async () => {
  await Effect.runPromise(runRequestRoutingProof(1))
})

test('keeps pure and mixed materialization causes request-scoped across two RPC hops', async () => {
  await Effect.runPromise(runRequestRoutingProof(2))
})

test('round-trips a mixed PushToLeader cause through its JSON wire schema', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const exitSchema = Schema.toCodecJson(Rpc.exitSchema(LeaderWorkerInnerPushToLeader))
      const encoded = yield* Schema.encodeUnknownEffect(exitSchema)(Exit.failCause(mixedCause))
      const decoded = yield* Schema.decodeUnknownEffect(exitSchema)(encoded)

      expect(Exit.isFailure(decoded)).toBe(true)
      if (Exit.isFailure(decoded) === false) return
      const failures = decoded.cause.reasons.filter(Cause.isFailReason)
      const defects = decoded.cause.reasons.filter(Cause.isDieReason)
      expect(failures.map((reason) => reason.error._tag)).toEqual(['MaterializeError'])
      expect(defects.map((reason) => (reason.defect as Error).message)).toEqual(['companion defect'])
    }),
  )
})
