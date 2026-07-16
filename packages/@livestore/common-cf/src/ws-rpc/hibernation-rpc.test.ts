/**
 * @fileoverview A Durable Object holding any pending timer never hibernates, and bills for full
 * wall-clock residency at zero traffic (livestorejs/livestore#1328).
 */
import { expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { WranglerDevServer } from '@livestore/utils-dev/wrangler'
import {
  Deferred,
  Effect,
  FetchHttpClient,
  Layer,
  References,
  RpcClient,
  RpcSerialization,
  Socket,
  Stream,
} from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { HibRpcs } from './hibernation-rpc-fixtures/rpc-schema.ts'

const testTimeout = 60_000
const IDLE_MS = 13_000 // production hibernates after ~10s idle

const withWranglerTest = Vitest.makeWithTestCtx({
  timeout: testTimeout,
  makeLayer: () =>
    WranglerDevServer.layer({
      cwd: `${import.meta.dirname}/hibernation-rpc-fixtures`,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          PlatformNode.NodeServices.layer,
          FetchHttpClient.layer,
          Layer.succeed(References.MinimumLogLevel, 'Debug'),
        ),
      ),
    ),
})

const protocolFor = (path: string) =>
  Layer.suspend(() =>
    Effect.gen(function* () {
      const server = yield* WranglerDevServer.WranglerDevServer
      return RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Socket.layerWebSocket(`ws://localhost:${server.port}${path}`)),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(RpcSerialization.layerJson),
      )
    }).pipe(Layer.unwrap),
  )

const observeHibernation = ({ path, withLivePull }: { path: string; withLivePull: boolean }) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(HibRpcs)
    yield* client.Ping({})
    if (withLivePull === true) {
      // Wait for a chunk rather than a fixed delay: a broken `Live` handler would otherwise leave no
      // park at all, and the hibernation assertion below would pass for exactly the wrong reason.
      const streaming = yield* Deferred.make<void>()
      yield* client.Live({}).pipe(
        Stream.tap(() => Deferred.succeed(streaming, undefined)),
        Stream.runDrain,
        Effect.forkScoped,
      )
      yield* Deferred.await(streaming).pipe(Effect.timeout('5 seconds'))
    }
    const { id: id1 } = yield* client.InstanceId({})
    yield* Effect.sleep(IDLE_MS)
    const { id: id2 } = yield* client.InstanceId({})
    return { id1, id2, hibernated: id1 !== id2 }
  }).pipe(Effect.provide(protocolFor(path)))

Vitest.describe('WS-RPC sync DO hibernation outcome', { timeout: testTimeout }, () => {
  // Each case owns a distinct DO, so one idle window covers all three instead of three.
  Vitest.live('an idle connection hibernates, and a pending timer prevents it', (test) =>
    Effect.gen(function* () {
      const [plain, livePull, sentinel] = yield* Effect.all(
        [
          observeHibernation({ path: '/real', withLivePull: false }),
          observeHibernation({ path: '/real-live-pull', withLivePull: true }),
          observeHibernation({ path: '/sentinel', withLivePull: false }),
        ],
        { concurrency: 'unbounded' },
      )

      expect(plain.hibernated, 'idle connection should hibernate').toBe(true)
      expect(livePull.hibernated, 'idle connection with a live pull should hibernate').toBe(true)
      expect(sentinel.hibernated, 'a pending long timer must keep the DO resident').toBe(false)
    }).pipe(withWranglerTest(test)),
  )
})
