import { Chunk, Deferred, Effect, identity, Layer, Logger, Schema, Stream, WebChannel } from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'
import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import { Packet } from './mesh-schema.js'
import type { MeshNode } from './node.js'
import { makeMeshNode } from './node.js'

// TODO test cases where in-between node only comes online later
// TODO test cases where other side tries to reconnect
// TODO test combination of connection types (message, proxy)
// TODO test "diamond shape" topology (A <> B1, A <> B2, B1 <> C, B2 <> C)
// TODO test cases where multiple entities try to claim to be the same channel end (e.g. A,B,B)
// TODO write tests with worker threads

const ExampleSchema = Schema.Struct({ message: Schema.String })

const connectNodesViaMessageChannel = (nodeA: MeshNode, nodeB: MeshNode) =>
  Effect.gen(function* () {
    const mc = new MessageChannel()
    const meshChannelAToB = yield* WebChannel.messagePortChannel({ port: mc.port1, schema: Packet })
    const meshChannelBToA = yield* WebChannel.messagePortChannel({ port: mc.port2, schema: Packet })

    yield* nodeA.addConnection({ target: nodeB.nodeName, connectionChannel: meshChannelAToB })
    yield* nodeB.addConnection({ target: nodeA.nodeName, connectionChannel: meshChannelBToA })

    return mc
  }).pipe(Effect.withSpan(`connectNodesViaMessageChannel:${nodeA.nodeName}↔${nodeB.nodeName}`))

const connectNodesViaBroadcastChannel = (nodeA: MeshNode, nodeB: MeshNode) =>
  Effect.gen(function* () {
    // Need to instantiate two different channels because they filter out messages they sent themselves
    const broadcastWebChannelA = yield* WebChannel.broadcastChannelWithAck({
      channelName: `${nodeA.nodeName}↔${nodeB.nodeName}`,
      listenSchema: Packet,
      sendSchema: Packet,
    })

    const broadcastWebChannelB = yield* WebChannel.broadcastChannelWithAck({
      channelName: `${nodeA.nodeName}↔${nodeB.nodeName}`,
      listenSchema: Packet,
      sendSchema: Packet,
    })

    yield* nodeA.addConnection({ target: nodeB.nodeName, connectionChannel: broadcastWebChannelA })
    yield* nodeB.addConnection({ target: nodeA.nodeName, connectionChannel: broadcastWebChannelB })
  }).pipe(Effect.withSpan(`connectNodesViaBroadcastChannel:${nodeA.nodeName}↔${nodeB.nodeName}`))

const createChannel = (source: MeshNode, target: string, options?: Partial<Parameters<MeshNode['makeChannel']>[0]>) =>
  source.makeChannel({
    target,
    channelName: options?.channelName ?? 'test',
    schema: ExampleSchema,
    // transferables: options?.transferables ?? 'prefer',
    mode: options?.mode ?? 'messagechannel',
    timeout: options?.timeout ?? 200,
  })

const getFirstMessage = <T1, T2>(channel: WebChannel.WebChannel<T1, T2>) =>
  channel.listen.pipe(
    Stream.flatten(),
    Stream.take(1),
    Stream.runCollect,
    Effect.map(([message]) => message),
  )

// NOTE we distinguish between undefined and 0 delays as it changes the fiber execution
const maybeDelay =
  (delay: number | undefined, label: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    delay === undefined
      ? effect
      : Effect.sleep(delay).pipe(Effect.withSpan(`${label}:delay(${delay})`), Effect.andThen(effect))

// TODO also make work without `Vitest.scopedLive` (i.e. with `Vitest.scoped`)
// probably requires controlling the clocks
Vitest.describe('webmesh node', { timeout: 1000 }, () => {
  Vitest.describe('A <> B', () => {
    Vitest.describe('prop tests', { timeout: 10_000 }, () => {
      const Delay = Schema.UndefinedOr(Schema.Literal(0, 1, 10, 50))
      // NOTE for message channels, we test both with and without transferables (i.e. proxying)
      const ChannelType = Schema.Literal('messagechannel', 'messagechannel.proxy', 'proxy')

      const fromChannelType = (
        channelType: typeof ChannelType.Type,
      ): {
        mode: 'messagechannel' | 'proxy'
        connectNodes: typeof connectNodesViaMessageChannel | typeof connectNodesViaBroadcastChannel
      } => {
        switch (channelType) {
          case 'proxy': {
            return { mode: 'proxy', connectNodes: connectNodesViaBroadcastChannel }
          }
          case 'messagechannel': {
            return { mode: 'messagechannel', connectNodes: connectNodesViaMessageChannel }
          }
          case 'messagechannel.proxy': {
            return { mode: 'proxy', connectNodes: connectNodesViaMessageChannel }
          }
        }
      }

      Vitest.scopedLive.prop(
        // Vitest.scopedLive.only(
        'a / b connect at different times with different channel types',
        [Delay, Delay, Delay, ChannelType],
        ([delayA, delayB, connectDelay, channelType], test) =>
          // (test) =>
          Effect.gen(function* () {
            // const delayA = 1
            // const delayB = 10
            // const connectDelay = 10
            // const channelType = 'message.prefer'
            // console.log('delayA', delayA, 'delayB', delayB, 'connectDelay', connectDelay, 'channelType', channelType)

            const nodeA = yield* makeMeshNode('A')
            const nodeB = yield* makeMeshNode('B')

            const { mode, connectNodes } = fromChannelType(channelType)

            const nodeACode = Effect.gen(function* () {
              const channelAToB = yield* createChannel(nodeA, 'B', { mode })

              yield* channelAToB.send({ message: 'A1' })
              expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'A2' })
            })

            const nodeBCode = Effect.gen(function* () {
              const channelBToA = yield* createChannel(nodeB, 'A', { mode })

              yield* channelBToA.send({ message: 'A2' })
              expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
            })

            yield* Effect.all(
              [
                connectNodes(nodeA, nodeB).pipe(maybeDelay(connectDelay, 'connectNodes')),
                nodeACode.pipe(maybeDelay(delayA, 'nodeACode')),
                nodeBCode.pipe(maybeDelay(delayB, 'nodeBCode')),
              ],
              { concurrency: 'unbounded' },
            )
          }).pipe(
            withCtx(test, { skipOtel: true, suffix: `delayA=${delayA} delayB=${delayB} channelType=${channelType}` }),
          ),
      )

      // Vitest.scopedLive.only(
      //   'reconnects',
      //   (test) =>
      Vitest.scopedLive.prop(
        'b reconnects',
        [Delay, Delay, ChannelType],
        ([waitForOfflineDelay, sleepDelay, channelType], test) =>
          Effect.gen(function* () {
            // const waitForOfflineDelay = 0
            // const sleepDelay = 10
            // const channelType = 'proxy'
            // console.log(
            //   'waitForOfflineDelay',
            //   waitForOfflineDelay,
            //   'sleepDelay',
            //   sleepDelay,
            //   'channelType',
            //   channelType,
            // )

            const nodeA = yield* makeMeshNode('A')
            const nodeB = yield* makeMeshNode('B')

            const { mode, connectNodes } = fromChannelType(channelType)

            // TODO also optionally delay the connection
            yield* connectNodes(nodeA, nodeB)

            const waitForBToBeOffline =
              waitForOfflineDelay === undefined ? undefined : yield* Deferred.make<void, never>()

            const nodeACode = Effect.gen(function* () {
              const channelAToB = yield* createChannel(nodeA, 'B', { mode })

              yield* channelAToB.send({ message: 'A1' })
              expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B1' })

              if (waitForBToBeOffline !== undefined) {
                yield* waitForBToBeOffline
              }

              yield* channelAToB.send({ message: 'A2' })
              expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B2' })
            })

            // Simulating node b going offline and then coming back online
            const nodeBCode = Effect.gen(function* () {
              yield* Effect.gen(function* () {
                const channelBToA = yield* createChannel(nodeB, 'A', { mode })

                yield* channelBToA.send({ message: 'B1' })
                expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
              }).pipe(Effect.scoped)

              if (waitForBToBeOffline !== undefined) {
                yield* Deferred.succeed(waitForBToBeOffline, void 0)
              }

              if (sleepDelay !== undefined) {
                yield* Effect.sleep(sleepDelay).pipe(Effect.withSpan(`B:sleep(${sleepDelay})`))
              }

              yield* Effect.gen(function* () {
                const channelBToA = yield* createChannel(nodeB, 'A', { mode })

                yield* channelBToA.send({ message: 'B2' })
                expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A2' })
              }).pipe(Effect.scoped)
            })

            yield* Effect.all([nodeACode, nodeBCode], { concurrency: 'unbounded' })
          }).pipe(
            withCtx(test, {
              skipOtel: true,
              suffix: `waitForOfflineDelay=${waitForOfflineDelay} sleepDelay=${sleepDelay} channelType=${channelType}`,
            }),
          ),
      )

      const ChannelTypeWithoutMessageChannelProxy = Schema.Literal('proxy', 'messagechannel')
      Vitest.scopedLive.prop(
        'replace connection while keeping the channel',
        [ChannelTypeWithoutMessageChannelProxy],
        ([channelType], test) =>
          Effect.gen(function* () {
            const nodeA = yield* makeMeshNode('A')
            const nodeB = yield* makeMeshNode('B')

            const { mode, connectNodes } = fromChannelType(channelType)

            yield* connectNodes(nodeA, nodeB)

            const waitForConnectionReplacement = yield* Deferred.make<void>()

            const nodeACode = Effect.gen(function* () {
              const channelAToB = yield* createChannel(nodeA, 'B', { mode })

              yield* channelAToB.send({ message: 'A1' })
              expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B1' })

              yield* waitForConnectionReplacement

              yield* channelAToB.send({ message: 'A2' })
              expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B2' })
            })

            const nodeBCode = Effect.gen(function* () {
              const channelBToA = yield* createChannel(nodeB, 'A', { mode })

              yield* channelBToA.send({ message: 'B1' })
              expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })

              // Switch out connection while keeping the channel
              yield* nodeA.removeConnection('B')
              yield* nodeB.removeConnection('A')
              yield* connectNodes(nodeA, nodeB)
              yield* Deferred.succeed(waitForConnectionReplacement, void 0)

              yield* channelBToA.send({ message: 'B2' })
              expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A2' })
            })

            yield* Effect.all([nodeACode, nodeBCode], { concurrency: 'unbounded' })
          }).pipe(withCtx(test, { skipOtel: true, suffix: `channelType=${channelType}` })),
      )

      Vitest.describe.todo('TODO improve latency', () => {
        // TODO we need to improve latency when sending messages concurrently
        Vitest.scopedLive.prop(
          'concurrent messages',
          [ChannelType, Schema.Int.pipe(Schema.between(1, 50))],
          ([channelType, count], test) =>
            Effect.gen(function* () {
              const nodeA = yield* makeMeshNode('A')
              const nodeB = yield* makeMeshNode('B')

              const { mode, connectNodes } = fromChannelType(channelType)
              console.log('channelType', channelType, 'mode', mode)

              const nodeACode = Effect.gen(function* () {
                const channelAToB = yield* createChannel(nodeA, 'B', { mode })

                // send 10 times A1
                yield* Effect.forEach(
                  Chunk.makeBy(count, (i) => ({ message: `A${i}` })),
                  channelAToB.send,
                  { concurrency: 'unbounded' },
                )

                expect(yield* channelAToB.listen.pipe(Stream.flatten(), Stream.take(count), Stream.runCollect)).toEqual(
                  Chunk.makeBy(count, (i) => ({ message: `B${i}` })),
                )
                // expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'A2' })
              })

              const nodeBCode = Effect.gen(function* () {
                const channelBToA = yield* createChannel(nodeB, 'A', { mode })

                // send 10 times B1
                yield* Effect.forEach(
                  Chunk.makeBy(count, (i) => ({ message: `B${i}` })),
                  channelBToA.send,
                  { concurrency: 'unbounded' },
                )

                expect(yield* channelBToA.listen.pipe(Stream.flatten(), Stream.take(count), Stream.runCollect)).toEqual(
                  Chunk.makeBy(count, (i) => ({ message: `A${i}` })),
                )
              })

              yield* Effect.all([nodeACode, nodeBCode, connectNodes(nodeA, nodeB).pipe(Effect.delay(100))], {
                concurrency: 'unbounded',
              })
            }).pipe(withCtx(test, { skipOtel: false, suffix: `channelType=${channelType} count=${count}` })),
          { timeout: 30_000 },
        )
      })
    })

    Vitest.scopedLive('manual debug test', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        // const connectNodes = connectNodesViaBroadcastChannel
        const connectNodes = connectNodesViaMessageChannel

        const nodeACode = Effect.gen(function* () {
          const channelAToB = yield* createChannel(nodeA, 'B')

          yield* channelAToB.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'A2' })
        })

        const nodeBCode = Effect.gen(function* () {
          const channelBToA = yield* createChannel(nodeB, 'A')

          yield* channelBToA.send({ message: 'A2' })
          expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeBCode, connectNodes(nodeA, nodeB).pipe(Effect.delay(100))], {
          concurrency: 'unbounded',
        })
      }).pipe(withCtx(test)),
    )

    Vitest.scopedLive('broadcast connection with message channel', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        yield* connectNodesViaBroadcastChannel(nodeA, nodeB)

        const err = yield* createChannel(nodeA, 'B', { mode: 'messagechannel' }).pipe(Effect.timeout(200), Effect.flip)
        expect(err._tag).toBe('TimeoutException')
      }).pipe(withCtx(test)),
    )
  })

  Vitest.describe('A <> B <> C', () => {
    Vitest.scopedLive('should work', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        yield* connectNodesViaMessageChannel(nodeA, nodeB)
        yield* connectNodesViaMessageChannel(nodeB, nodeC)

        const nodeACode = Effect.gen(function* () {
          const channelAToC = yield* createChannel(nodeA, 'C')

          yield* channelAToC.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'C1' })
          expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'C2' })
        })

        const nodeCCode = Effect.gen(function* () {
          const channelCToA = yield* createChannel(nodeC, 'A')
          yield* channelCToA.send({ message: 'C1' })
          yield* channelCToA.send({ message: 'C2' })
          yield* channelCToA.send({ message: 'C3' })
          expect(yield* getFirstMessage(channelCToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeCCode], { concurrency: 'unbounded' })
      }).pipe(withCtx(test)),
    )

    Vitest.scopedLive('should work - delayed connection', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        const connectNodes = connectNodesViaMessageChannel
        // const connectNodes = connectNodesViaBroadcastChannel
        yield* connectNodes(nodeA, nodeB)
        // yield* connectNodes(nodeB, nodeC)

        const nodeACode = Effect.gen(function* () {
          const channelAToC = yield* createChannel(nodeA, 'C')

          yield* channelAToC.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'C1' })
        })

        const nodeCCode = Effect.gen(function* () {
          const channelCToA = yield* createChannel(nodeC, 'A')
          yield* channelCToA.send({ message: 'C1' })
          expect(yield* getFirstMessage(channelCToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeCCode, connectNodes(nodeB, nodeC).pipe(Effect.delay(100))], {
          concurrency: 'unbounded',
        })
      }).pipe(withCtx(test)),
    )

    Vitest.scopedLive('proxy channel', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        yield* connectNodesViaBroadcastChannel(nodeA, nodeB)
        yield* connectNodesViaBroadcastChannel(nodeB, nodeC)

        const nodeACode = Effect.gen(function* () {
          const channelAToC = yield* createChannel(nodeA, 'C', { mode: 'proxy' })
          yield* channelAToC.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'hello from nodeC' })
        })

        const nodeCCode = Effect.gen(function* () {
          const channelCToA = yield* createChannel(nodeC, 'A', { mode: 'proxy' })
          yield* channelCToA.send({ message: 'hello from nodeC' })
          expect(yield* getFirstMessage(channelCToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeCCode], { concurrency: 'unbounded' })
      }).pipe(withCtx(test)),
    )

    Vitest.scopedLive('should fail', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        yield* connectNodesViaMessageChannel(nodeA, nodeB)
        // We're not connecting nodeB and nodeC, so this should fail

        const nodeACode = Effect.gen(function* () {
          const err = yield* createChannel(nodeA, 'C').pipe(Effect.timeout(200), Effect.flip)
          expect(err._tag).toBe('TimeoutException')
        })

        const nodeCCode = Effect.gen(function* () {
          const err = yield* createChannel(nodeC, 'A').pipe(Effect.timeout(200), Effect.flip)
          expect(err._tag).toBe('TimeoutException')
        })

        yield* Effect.all([nodeACode, nodeCCode], { concurrency: 'unbounded' })
      }).pipe(withCtx(test)),
    )
  })

  Vitest.describe('mixture of messagechannel and proxy connections', () => {
    // TODO test case to better guard against case where side A tries to create a proxy channel to B
    // and side B tries to create a messagechannel to A
    Vitest.scopedLive('should work for proxy channels', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        yield* connectNodesViaMessageChannel(nodeB, nodeA)
        const err = yield* connectNodesViaBroadcastChannel(nodeA, nodeB).pipe(Effect.flip)

        expect(err._tag).toBe('ConnectionAlreadyExistsError')
      }).pipe(withCtx(test)),
    )

    // TODO this currently fails but should work. probably needs some more guarding internally.
    Vitest.scopedLive.skip('should work for messagechannels', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        yield* connectNodesViaMessageChannel(nodeB, nodeA)
        yield* connectNodesViaBroadcastChannel(nodeA, nodeB)

        const nodeACode = Effect.gen(function* () {
          const channelAToB = yield* createChannel(nodeA, 'B', { mode: 'messagechannel' })
          yield* channelAToB.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B1' })
        })

        const nodeBCode = Effect.gen(function* () {
          const channelBToA = yield* createChannel(nodeB, 'A', { mode: 'messagechannel' })
          yield* channelBToA.send({ message: 'B1' })
          expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeBCode], { concurrency: 'unbounded' })
      }).pipe(withCtx(test)),
    )
  })
})

const envTruish = (env: string | undefined) => env !== undefined && env !== 'false' && env !== '0'
const isCi = envTruish(process.env.CI)

const otelLayer = isCi ? Layer.empty : OtelLiveHttp({ serviceName: 'webmesh-node-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix, skipOtel = false }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(isCi ? 10_000 : 500),
      Effect.provide(Logger.pretty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
