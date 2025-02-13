import '@livestore/utils/node-vitest-polyfill'

import { IS_CI } from '@livestore/utils'
import {
  Chunk,
  Deferred,
  Effect,
  Exit,
  identity,
  Layer,
  Logger,
  Schema,
  Scope,
  Stream,
  WebChannel,
} from '@livestore/utils/effect'
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

const connectNodesViaMessageChannel = (nodeA: MeshNode, nodeB: MeshNode, options?: { replaceIfExists?: boolean }) =>
  Effect.gen(function* () {
    const mc = new MessageChannel()
    const meshChannelAToB = yield* WebChannel.messagePortChannel({ port: mc.port1, schema: Packet })
    const meshChannelBToA = yield* WebChannel.messagePortChannel({ port: mc.port2, schema: Packet })

    yield* nodeA.addConnection({
      target: nodeB.nodeName,
      connectionChannel: meshChannelAToB,
      replaceIfExists: options?.replaceIfExists,
    })
    yield* nodeB.addConnection({
      target: nodeA.nodeName,
      connectionChannel: meshChannelBToA,
      replaceIfExists: options?.replaceIfExists,
    })
  }).pipe(Effect.withSpan(`connectNodesViaMessageChannel:${nodeA.nodeName}↔${nodeB.nodeName}`))

const connectNodesViaBroadcastChannel = (nodeA: MeshNode, nodeB: MeshNode, options?: { replaceIfExists?: boolean }) =>
  Effect.gen(function* () {
    // Need to instantiate two different channels because they filter out messages they sent themselves
    const broadcastWebChannelA = yield* WebChannel.broadcastChannelWithAck({
      channelName: `${nodeA.nodeName}↔${nodeB.nodeName}`,
      schema: Packet,
    })

    const broadcastWebChannelB = yield* WebChannel.broadcastChannelWithAck({
      channelName: `${nodeA.nodeName}↔${nodeB.nodeName}`,
      schema: Packet,
    })

    yield* nodeA.addConnection({
      target: nodeB.nodeName,
      connectionChannel: broadcastWebChannelA,
      replaceIfExists: options?.replaceIfExists,
    })
    yield* nodeB.addConnection({
      target: nodeA.nodeName,
      connectionChannel: broadcastWebChannelB,
      replaceIfExists: options?.replaceIfExists,
    })
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

const testTimeout = IS_CI ? 30_000 : 1000
const propTestTimeout = IS_CI ? 60_000 : 20_000

// TODO also make work without `Vitest.scopedLive` (i.e. with `Vitest.scoped`)
// probably requires controlling the clocks
Vitest.describe('webmesh node', { timeout: testTimeout }, () => {
  Vitest.describe('A <> B', () => {
    Vitest.describe('prop tests', { timeout: propTestTimeout }, () => {
      const Delay = Schema.UndefinedOr(Schema.Literal(0, 1, 10, 50))
      // NOTE for message channels, we test both with and without transferables (i.e. proxying)
      const ChannelType = Schema.Literal('messagechannel', 'messagechannel.proxy', 'proxy')
      const NodeNames = Schema.Union(
        Schema.Tuple(Schema.Literal('A'), Schema.Literal('B')),
        Schema.Tuple(Schema.Literal('B'), Schema.Literal('A')),
      )

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

      const exchangeMessages = ({
        nodeX,
        nodeY,
        channelType,
        // numberOfMessages = 1,
        delays,
      }: {
        nodeX: MeshNode
        nodeY: MeshNode
        channelType: 'messagechannel' | 'proxy' | 'messagechannel.proxy'
        numberOfMessages?: number
        delays?: { x?: number; y?: number; connect?: number }
      }) =>
        Effect.gen(function* () {
          const nodeLabel = { x: nodeX.nodeName, y: nodeY.nodeName }
          const { mode, connectNodes } = fromChannelType(channelType)

          const nodeXCode = Effect.gen(function* () {
            const channelXToY = yield* createChannel(nodeX, nodeY.nodeName, { mode })

            yield* channelXToY.send({ message: `${nodeLabel.x}1` })
            // console.log('channelXToY', channelXToY.debugInfo)
            expect(yield* getFirstMessage(channelXToY)).toEqual({ message: `${nodeLabel.y}1` })
            // expect(channelXToY.debugInfo.connectCounter).toBe(1)
          })

          const nodeYCode = Effect.gen(function* () {
            const channelYToX = yield* createChannel(nodeY, nodeX.nodeName, { mode })

            yield* channelYToX.send({ message: `${nodeLabel.y}1` })
            // console.log('channelYToX', channelYToX.debugInfo)
            expect(yield* getFirstMessage(channelYToX)).toEqual({ message: `${nodeLabel.x}1` })
            // expect(channelYToX.debugInfo.connectCounter).toBe(1)
          })

          yield* Effect.all(
            [
              connectNodes(nodeX, nodeY).pipe(maybeDelay(delays?.connect, 'connectNodes')),
              nodeXCode.pipe(maybeDelay(delays?.x, `node${nodeLabel.x}Code`)),
              nodeYCode.pipe(maybeDelay(delays?.y, `node${nodeLabel.y}Code`)),
            ],
            { concurrency: 'unbounded' },
          ).pipe(Effect.withSpan(`exchangeMessages(${nodeLabel.x}↔${nodeLabel.y})`))
        })

      // const delayX = 40
      // const delayY = undefined
      // const connectDelay = undefined
      // const channelType = 'messagechannel'
      // const nodeNames = ['B', 'A'] as const
      // Vitest.scopedLive(
      //   'a / b connect at different times with different channel types',
      //   (test) =>
      Vitest.scopedLive.prop(
        'a / b connect at different times with different channel types',
        [Delay, Delay, Delay, ChannelType, NodeNames],
        ([delayX, delayY, connectDelay, channelType, nodeNames], test) =>
          Effect.gen(function* () {
            // console.log({ delayX, delayY, connectDelay, channelType, nodeNames })

            const [nodeNameX, nodeNameY] = nodeNames
            const nodeX = yield* makeMeshNode(nodeNameX)
            const nodeY = yield* makeMeshNode(nodeNameY)

            yield* exchangeMessages({
              nodeX,
              nodeY,
              channelType,
              delays: { x: delayX, y: delayY, connect: connectDelay },
            })
          }).pipe(
            withCtx(test, {
              skipOtel: true,
              suffix: `delayX=${delayX} delayY=${delayY} connectDelay=${connectDelay} channelType=${channelType} nodeNames=${nodeNames}`,
            }),
          ),
        // { fastCheck: { numRuns: 20 } },
      )

      {
        // const waitForOfflineDelay = undefined
        // const sleepDelay = 0
        // const channelType = 'messagechannel'
        // Vitest.scopedLive(
        //   'b reconnects',
        //   (test) =>
        Vitest.scopedLive.prop(
          'b reconnects',
          [Delay, Delay, ChannelType],
          ([waitForOfflineDelay, sleepDelay, channelType], test) =>
            Effect.gen(function* () {
              // console.log({ waitForOfflineDelay, sleepDelay, channelType })

              if (waitForOfflineDelay === undefined) {
                // TODO we still need to fix this scenario but it shouldn't really be common in practice
                return
              }

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

                console.log('nodeACode:waiting for B to be offline')
                if (waitForBToBeOffline !== undefined) {
                  yield* waitForBToBeOffline
                }

                yield* channelAToB.send({ message: 'A2' })
                expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B2' })
              })

              // Simulating node b going offline and then coming back online
              // This test also illustrates why we need a ack-message channel since otherwise
              // sent messages might get lost
              const nodeBCode = Effect.gen(function* () {
                yield* Effect.gen(function* () {
                  const channelBToA = yield* createChannel(nodeB, 'A', { mode })

                  yield* channelBToA.send({ message: 'B1' })
                  expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
                }).pipe(Effect.scoped, Effect.withSpan('nodeBCode:part1'))

                console.log('nodeBCode:B node going offline')
                if (waitForBToBeOffline !== undefined) {
                  yield* Deferred.succeed(waitForBToBeOffline, void 0)
                }

                if (sleepDelay !== undefined) {
                  yield* Effect.sleep(sleepDelay).pipe(Effect.withSpan(`B:sleep(${sleepDelay})`))
                }

                // Recreating the channel
                yield* Effect.gen(function* () {
                  const channelBToA = yield* createChannel(nodeB, 'A', { mode })

                  yield* channelBToA.send({ message: 'B2' })
                  expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A2' })
                }).pipe(Effect.scoped, Effect.withSpan('nodeBCode:part2'))
              })

              yield* Effect.all([nodeACode, nodeBCode], { concurrency: 'unbounded' }).pipe(Effect.withSpan('test'))
            }).pipe(
              withCtx(test, {
                skipOtel: true,
                suffix: `waitForOfflineDelay=${waitForOfflineDelay} sleepDelay=${sleepDelay} channelType=${channelType}`,
              }),
            ),
          { fastCheck: { numRuns: 20 } },
        )
      }

      Vitest.scopedLive('reconnect with re-created node', (test) =>
        Effect.gen(function* () {
          const nodeBgen1Scope = yield* Scope.make()

          const nodeA = yield* makeMeshNode('A')
          const nodeBgen1 = yield* makeMeshNode('B').pipe(Scope.extend(nodeBgen1Scope))

          yield* connectNodesViaMessageChannel(nodeA, nodeBgen1).pipe(Scope.extend(nodeBgen1Scope))

          // yield* Effect.sleep(100)

          const channelAToBOnce = yield* Effect.cached(createChannel(nodeA, 'B'))
          const nodeACode = Effect.gen(function* () {
            const channelAToB = yield* channelAToBOnce
            yield* channelAToB.send({ message: 'A1' })
            expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B1' })
            // expect(channelAToB.debugInfo.connectCounter).toBe(1)
          })

          const nodeBCode = (nodeB: MeshNode) =>
            Effect.gen(function* () {
              const channelBToA = yield* createChannel(nodeB, 'A')

              yield* channelBToA.send({ message: 'B1' })
              expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
              // expect(channelBToA.debugInfo.connectCounter).toBe(1)
            })

          yield* Effect.all([nodeACode, nodeBCode(nodeBgen1).pipe(Scope.extend(nodeBgen1Scope))], {
            concurrency: 'unbounded',
          }).pipe(Effect.withSpan('test1'))

          yield* Scope.close(nodeBgen1Scope, Exit.void)

          const nodeBgen2 = yield* makeMeshNode('B')
          yield* connectNodesViaMessageChannel(nodeA, nodeBgen2, { replaceIfExists: true })

          yield* Effect.all([nodeACode, nodeBCode(nodeBgen2)], { concurrency: 'unbounded' }).pipe(
            Effect.withSpan('test2'),
          )
        }).pipe(withCtx(test)),
      )

      const ChannelTypeWithoutMessageChannelProxy = Schema.Literal('proxy', 'messagechannel')
      Vitest.scopedLive.prop(
        'replace connection while keeping the channel',
        [ChannelTypeWithoutMessageChannelProxy, NodeNames],
        ([channelType, nodeNames], test) =>
          Effect.gen(function* () {
            const [nodeNameX, nodeNameY] = nodeNames
            const nodeX = yield* makeMeshNode(nodeNameX)
            const nodeY = yield* makeMeshNode(nodeNameY)
            const nodeLabel = { x: nodeX.nodeName, y: nodeY.nodeName }

            const { mode, connectNodes } = fromChannelType(channelType)

            yield* connectNodes(nodeX, nodeY)

            const waitForConnectionReplacement = yield* Deferred.make<void>()

            const nodeXCode = Effect.gen(function* () {
              const channelXToY = yield* createChannel(nodeX, nodeLabel.y, { mode })

              yield* channelXToY.send({ message: `${nodeLabel.x}1` })
              expect(yield* getFirstMessage(channelXToY)).toEqual({ message: `${nodeLabel.y}1` })

              yield* waitForConnectionReplacement

              yield* channelXToY.send({ message: `${nodeLabel.x}2` })
              expect(yield* getFirstMessage(channelXToY)).toEqual({ message: `${nodeLabel.y}2` })
            })

            const nodeYCode = Effect.gen(function* () {
              const channelYToX = yield* createChannel(nodeY, nodeLabel.x, { mode })

              yield* channelYToX.send({ message: `${nodeLabel.y}1` })
              expect(yield* getFirstMessage(channelYToX)).toEqual({ message: `${nodeLabel.x}1` })

              // Switch out connection while keeping the channel
              yield* nodeX.removeConnection(nodeLabel.y)
              yield* nodeY.removeConnection(nodeLabel.x)
              yield* connectNodes(nodeX, nodeY)
              yield* Deferred.succeed(waitForConnectionReplacement, void 0)

              yield* channelYToX.send({ message: `${nodeLabel.y}2` })
              expect(yield* getFirstMessage(channelYToX)).toEqual({ message: `${nodeLabel.x}2` })
            })

            yield* Effect.all([nodeXCode, nodeYCode], { concurrency: 'unbounded' })
          }).pipe(
            withCtx(test, {
              skipOtel: true,
              suffix: `channelType=${channelType} nodeNames=${nodeNames}`,
            }),
          ),
        { fastCheck: { numRuns: 10 } },
      )

      Vitest.describe('TODO improve latency', () => {
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
            }).pipe(
              withCtx(test, {
                skipOtel: true,
                suffix: `channelType=${channelType} count=${count}`,
                timeout: testTimeout * 2,
              }),
            ),
          { fastCheck: { numRuns: 10 } },
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
          expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'C3' })
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

        yield* Effect.all(
          [
            nodeACode,
            nodeCCode,
            connectNodes(nodeB, nodeC).pipe(Effect.delay(100), Effect.withSpan('connect-nodeB-nodeC-delay(100)')),
          ],
          { concurrency: 'unbounded' },
        )
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

    Vitest.scopedLive('reconnect with re-created node', (test) =>
      Effect.gen(function* () {
        const nodeCgen1Scope = yield* Scope.make()

        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeCgen1 = yield* makeMeshNode('C').pipe(Scope.extend(nodeCgen1Scope))

        yield* connectNodesViaMessageChannel(nodeA, nodeB)
        yield* connectNodesViaMessageChannel(nodeB, nodeCgen1).pipe(Scope.extend(nodeCgen1Scope))

        const nodeACode = Effect.gen(function* () {
          const channelAToB = yield* createChannel(nodeA, 'C')

          yield* channelAToB.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'C1' })
        })

        const nodeCCode = (nodeB: MeshNode) =>
          Effect.gen(function* () {
            const channelBToA = yield* createChannel(nodeB, 'A')

            yield* channelBToA.send({ message: 'C1' })
            expect(yield* getFirstMessage(channelBToA)).toEqual({ message: 'A1' })
          })

        yield* Effect.all([nodeACode, nodeCCode(nodeCgen1)], { concurrency: 'unbounded' }).pipe(
          Effect.withSpan('test1'),
          Scope.extend(nodeCgen1Scope),
        )

        yield* Scope.close(nodeCgen1Scope, Exit.void)

        const nodeCgen2 = yield* makeMeshNode('C')
        yield* connectNodesViaMessageChannel(nodeB, nodeCgen2, { replaceIfExists: true })

        yield* Effect.all([nodeACode, nodeCCode(nodeCgen2)], { concurrency: 'unbounded' }).pipe(
          Effect.withSpan('test2'),
        )
      }).pipe(withCtx(test)),
    )
  })

  /**
   *    A
   *   / \
   *  B   C
   *   \ /
   *    D
   */
  Vitest.describe('diamond topology', () => {
    Vitest.scopedLive('should work', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')
        const nodeD = yield* makeMeshNode('D')

        yield* connectNodesViaMessageChannel(nodeA, nodeB)
        yield* connectNodesViaMessageChannel(nodeA, nodeC)
        yield* connectNodesViaMessageChannel(nodeB, nodeD)
        yield* connectNodesViaMessageChannel(nodeC, nodeD)

        const nodeACode = Effect.gen(function* () {
          const channelAToD = yield* createChannel(nodeA, 'D')
          yield* channelAToD.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToD)).toEqual({ message: 'D1' })
        })

        const nodeDCode = Effect.gen(function* () {
          const channelDToA = yield* createChannel(nodeD, 'A')
          yield* channelDToA.send({ message: 'D1' })
          expect(yield* getFirstMessage(channelDToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeDCode], { concurrency: 'unbounded' })
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
    Vitest.scopedLive('should work for messagechannels', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        yield* connectNodesViaMessageChannel(nodeB, nodeA)
        yield* connectNodesViaBroadcastChannel(nodeB, nodeC)

        const nodeACode = Effect.gen(function* () {
          const channelAToC = yield* createChannel(nodeA, 'C', { mode: 'proxy' })
          yield* channelAToC.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'C1' })
        })

        const nodeCCode = Effect.gen(function* () {
          const channelCToA = yield* createChannel(nodeC, 'A', { mode: 'proxy' })
          yield* channelCToA.send({ message: 'C1' })
          expect(yield* getFirstMessage(channelCToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeCCode], { concurrency: 'unbounded' })
      }).pipe(withCtx(test)),
    )
  })
})

const otelLayer = IS_CI ? Layer.empty : OtelLiveHttp({ serviceName: 'webmesh-node-test', skipLogUrl: false })

const withCtx =
  (
    testContext: Vitest.TaskContext,
    { suffix, skipOtel = false, timeout = testTimeout }: { suffix?: string; skipOtel?: boolean; timeout?: number } = {},
  ) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(timeout),
      Effect.provide(Logger.pretty),
      Effect.scoped, // We need to scope the effect manually here because otherwise the span is not closed
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      skipOtel ? identity : Effect.provide(otelLayer),
    )
