import { Effect, FetchHttpClient, KeyValueStore, Option, Stream } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import { makeSyncBackend } from './mod.ts'

Effect.gen(function* () {
  const backend = yield* makeSyncBackend({
    baseUrl: 'http://localhost:3000',
  })({ storeId: 'test-store', clientId: 'test-client', payload: undefined })

  yield* backend.connect
  yield* backend.ping
  yield* backend.push([
    {
      seqNum: 1 as any,
      parentSeqNum: 0 as any,
      clientId: 'test-client',
      sessionId: 'test-session',
      args: { foo: 'bar' },
      name: 'test-event',
    },
    {
      seqNum: 2 as any,
      parentSeqNum: 1 as any,
      clientId: 'test-client',
      sessionId: 'test-session',
      args: { baz: 'qux' },
      name: 'test-event-2',
    },
  ])
  yield* backend.pull(Option.none(), { live: true }).pipe(Stream.runForEach(Effect.log))
}).pipe(
  Effect.provide([FetchHttpClient.layer, KeyValueStore.layerMemory]),
  Effect.scoped,
  PlatformNode.NodeRuntime.runMain,
)
