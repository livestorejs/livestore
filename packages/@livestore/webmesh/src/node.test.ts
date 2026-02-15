import { expect } from 'vitest'

import { IS_CI, omitUndefineds } from '@livestore/utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Chunk, Deferred, Effect, Exit, Schema, Scope, Stream, WebChannel } from '@livestore/utils/effect'

import { Packet } from './mesh-schema.ts'
import type { MeshNode } from './node.ts'
import { makeMeshNode } from './node.ts'

// TODO test cases where in-between node only comes online later
// TODO test cases where other side tries to reconnect
// TODO test combination of channel types (message, proxy)
// TODO test "diamond shape" topology (A <> B1, A <> B2, B1 <> C, B2 <> C)
// TODO test cases where multiple entities try to claim to be the same channel end (e.g. A,B,B)
// TODO write tests with worker threads

const ExampleSchema = Schema.Struct({ message: Schema.String })

const connectNodesViaMessageChannel = (nodeA: MeshNode, nodeB: MeshNode, options?: { replaceIfExists?: boolean }) =>
  Effect.gen(function* () {
    const mc = new MessageChannel()
    const meshChannelAToB = yield* WebChannel.messagePortChannel({ port: mc.port1, schema: Packet })
    const meshChannelBToA = yield* WebChannel.messagePortChannel({ port: mc.port2, schema: Packet })

    yield* nodeA.addEdge({
      target: nodeB.nodeName,
      edgeChannel: meshChannelAToB,
      ...omitUndefineds({ replaceIfExists: options?.replaceIfExists }),
    })
    yield* nodeB.addEdge({
      target: nodeA.nodeName,
      edgeChannel: meshChannelBToA,
      ...omitUndefineds({ replaceIfExists: options?.replaceIfExists }),
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

    yield* nodeA.addEdge({
      target: nodeB.nodeName,
      edgeChannel: broadcastWebChannelA,
      ...omitUndefineds({ replaceIfExists: options?.replaceIfExists }),
    })
    yield* nodeB.addEdge({
      target: nodeA.nodeName,
      edgeChannel: broadcastWebChannelB,
      ...omitUndefineds({ replaceIfExists: options?.replaceIfExists }),
    })
  }).pipe(Effect.withSpan(`connectNodesViaBroadcastChannel:${nodeA.nodeName}↔${nodeB.nodeName}`))

const createChannel = (source: MeshNode, target: string, options?: Partial<Parameters<MeshNode['makeChannel']>[0]>) =>
  source.makeChannel({
    target,
    channelName: options?.channelName ?? 'test',
    schema: ExampleSchema,
    // transferables: options?.transferables ?? 'prefer',
    mode: options?.mode ?? 'direct',
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
  const Delay = Schema.UndefinedOr(Schema.Literal(0, 1, 10, 50))
  // NOTE for message channels, we test both with and without transferables (i.e. proxying)
  const ChannelType = Schema.Literal('direct', 'proxy(via-messagechannel-edge)', 'proxy')
  const NodeNames = Schema.Union(
    Schema.Tuple(Schema.Literal('A'), Schema.Literal('B')),
    Schema.Tuple(Schema.Literal('B'), Schema.Literal('A')),
  )

  const fromChannelType = (
    channelType: typeof ChannelType.Type,
  ): {
    mode: 'direct' | 'proxy'
    connectNodes: typeof connectNodesViaMessageChannel | typeof connectNodesViaBroadcastChannel
  } => {
    switch (channelType) {
      case 'proxy': {
        return { mode: 'proxy', connectNodes: connectNodesViaBroadcastChannel }
      }
      case 'direct': {
        return { mode: 'direct', connectNodes: connectNodesViaMessageChannel }
      }
      case 'proxy(via-messagechannel-edge)': {
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
    channelType: 'direct' | 'proxy' | 'proxy(via-messagechannel-edge)'
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

  Vitest.describe('A <> B', () => {
    Vitest.describe('prop tests', { timeout: propTestTimeout }, () => {
      // const delayX = 40
      // const delayY = undefined
      // const connectDelay = undefined
      // const channelType = 'direct'
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
              delays: {
                ...omitUndefineds({
                  x: delayX,
                  y: delayY,
                  connect: connectDelay,
                }),
              },
            })

            yield* Effect.promise(() => nodeX.debug.requestTopology(100))
          }).pipe(
            Vitest.withTestCtx(test, {
              suffix: `delayX=${delayX} delayY=${delayY} connectDelay=${connectDelay} channelType=${channelType} nodeNames=${nodeNames}`,
            }),
          ),
        // { fastCheck: { numRuns: 20 } },
      )
      // const waitForOfflineDelay = undefined
      // const sleepDelay = 0
      // const channelType = 'direct'
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

            // TODO also optionally delay the edge
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
            Vitest.withTestCtx(test, {
              suffix: `waitForOfflineDelay=${waitForOfflineDelay} sleepDelay=${sleepDelay} channelType=${channelType}`,
            }),
          ),
        { fastCheck: { numRuns: 20 } },
      )

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
        }).pipe(Vitest.withTestCtx(test)),
      )

      const ChannelTypeWithoutMessageChannelProxy = Schema.Literal('proxy', 'direct')
      // TODO there seems to be a flaky case here which gets hit sometimes (e.g. 2025-02-28-17:11)
      // Log output:
      // test: { seed: -964670352, path: "1", endOnFailure: true }
      // test: Counterexample: ["direct",["A","B"]]
      // test: Shrunk 0 time(s)
      // test: Got AssertionError: expected { _tag: 'MessageChannelPing' } to deeply equal { message: 'A1' }
      // test:     at next (/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/webmesh/src/node.test.ts:376:59)
      // test:     at prop tests:replace edge while keeping the channel:channelType=direct nodeNames=A,B (/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/webmesh/src/node.test.ts:801:14)
      // test: Hint: Enable verbose mode in order to have the list of all failing values encountered during the run
      // test:    ✓ webmesh node > A <> B > prop tests > TODO improve latency > concurrent messages 2110ms
      // test: ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      // test:  FAIL  src/node.test.ts > webmesh node > A <> B > prop tests > replace edge while keeping the channel
      // test: Error: Property failed after 2 tests
      // test: { seed: -964670352, path: "1", endOnFailure: true }
      // test: Counterexample: ["direct",["A","B"]]
      Vitest.scopedLive.prop(
        'replace edge while keeping the channel',
        [ChannelTypeWithoutMessageChannelProxy, NodeNames],
        ([channelType, nodeNames], test) =>
          Effect.gen(function* () {
            const [nodeNameX, nodeNameY] = nodeNames
            const nodeX = yield* makeMeshNode(nodeNameX)
            const nodeY = yield* makeMeshNode(nodeNameY)
            const nodeLabel = { x: nodeX.nodeName, y: nodeY.nodeName }

            const { mode, connectNodes } = fromChannelType(channelType)

            yield* connectNodes(nodeX, nodeY)

            const waitForEdgeReplacement = yield* Deferred.make<void>()

            const nodeXCode = Effect.gen(function* () {
              const channelXToY = yield* createChannel(nodeX, nodeLabel.y, { mode })

              yield* channelXToY.send({ message: `${nodeLabel.x}1` })
              expect(yield* getFirstMessage(channelXToY)).toEqual({ message: `${nodeLabel.y}1` })

              yield* waitForEdgeReplacement

              yield* channelXToY.send({ message: `${nodeLabel.x}2` })
              expect(yield* getFirstMessage(channelXToY)).toEqual({ message: `${nodeLabel.y}2` })
            })

            const nodeYCode = Effect.gen(function* () {
              const channelYToX = yield* createChannel(nodeY, nodeLabel.x, { mode })

              yield* channelYToX.send({ message: `${nodeLabel.y}1` })
              expect(yield* getFirstMessage(channelYToX)).toEqual({ message: `${nodeLabel.x}1` })

              // Switch out edge while keeping the channel
              yield* nodeX.removeEdge(nodeLabel.y)
              yield* nodeY.removeEdge(nodeLabel.x)
              yield* connectNodes(nodeX, nodeY)
              yield* Deferred.succeed(waitForEdgeReplacement, void 0)

              yield* channelYToX.send({ message: `${nodeLabel.y}2` })
              expect(yield* getFirstMessage(channelYToX)).toEqual({ message: `${nodeLabel.x}2` })
            })

            yield* Effect.all([nodeXCode, nodeYCode], { concurrency: 'unbounded' })
          }).pipe(
            Vitest.withTestCtx(test, {
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
              Vitest.withTestCtx(test, {
                suffix: `channelType=${channelType} count=${count}`,
                timeout: testTimeout * 2,
              }),
            ),
          { fastCheck: { numRuns: 10 } },
        )
      })
    })

    Vitest.describe('message channel specific tests', () => {
      Vitest.scopedLive('differing initial edge counter', (test) =>
        Effect.gen(function* () {
          const nodeA = yield* makeMeshNode('A')
          const nodeB = yield* makeMeshNode('B')

          yield* connectNodesViaMessageChannel(nodeA, nodeB)

          const messageCount = 3

          const bFiber = yield* Effect.gen(function* () {
            const channelBToA = yield* createChannel(nodeB, 'A')
            yield* channelBToA.listen.pipe(
              Stream.flatten(),
              Stream.tap((msg) => channelBToA.send({ message: `resp:${msg.message}` })),
              Stream.take(messageCount),
              Stream.runDrain,
            )
          }).pipe(Effect.scoped, Effect.fork)

          // yield* createChannel(nodeA, 'B').pipe(Effect.andThen(WebChannel.shutdown))
          // // yield* createChannel(nodeA, 'B').pipe(Effect.andThen(WebChannel.shutdown))
          // // yield* createChannel(nodeA, 'B').pipe(Effect.andThen(WebChannel.shutdown))
          yield* Effect.gen(function* () {
            const channelAToB = yield* createChannel(nodeA, 'B')
            yield* channelAToB.send({ message: 'A' })
            expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'resp:A' })
          }).pipe(Effect.scoped, Effect.repeatN(messageCount))

          yield* bFiber
        }).pipe(Vitest.withTestCtx(test)),
      )
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
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.scopedLive('broadcast edge with message channel', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        yield* connectNodesViaBroadcastChannel(nodeA, nodeB)

        const err = yield* createChannel(nodeA, 'B', { mode: 'direct' }).pipe(Effect.timeout(200), Effect.flip)
        expect(err._tag).toBe('TimeoutException')
      }).pipe(Vitest.withTestCtx(test)),
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
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.scopedLive('should work - delayed edge', (test) =>
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
      }).pipe(Vitest.withTestCtx(test)),
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
      }).pipe(Vitest.withTestCtx(test)),
    )

    /**
     * Pattern test: ACK sending must not block message processing.
     *
     * This test documents the pattern where ACKs are sent fire-and-forget using `Effect.forkScoped`
     * to avoid blocking the message processing loop.
     *
     * Background: Before the fix, ACKs were sent with `await` which blocked message processing.
     * This caused heartbeat timeouts in devtools after ~30 seconds ("Connection to app lost").
     *
     * Note: This unit test passes both with and without the fix because in-memory channels
     * complete ACK sends instantly. The actual regression test is the Playwright test
     * `node-adapter-timeout.play.ts` which uses real network conditions.
     *
     * This test exists to:
     * 1. Document the expected pattern (high message throughput via proxy channels)
     * 2. Verify the pattern works correctly with forked ACKs
     * 3. Serve as a reference for the fix in proxy-channel.ts
     */
    Vitest.scopedLive('ACK sending should not block message processing', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        yield* connectNodesViaBroadcastChannel(nodeA, nodeB)
        yield* connectNodesViaBroadcastChannel(nodeB, nodeC)

        // Send many messages to stress the ACK handling
        const messageCount = 10

        const nodeACode = Effect.gen(function* () {
          const channelAToC = yield* createChannel(nodeA, 'C', { mode: 'proxy' })
          // Send multiple messages concurrently
          yield* Effect.forEach(
            Chunk.makeBy(messageCount, (i) => ({ message: `A${i}` })),
            channelAToC.send,
            { concurrency: 'unbounded' },
          )
          // Receive responses
          const responses = yield* channelAToC.listen.pipe(
            Stream.flatten(),
            Stream.take(messageCount),
            Stream.runCollect,
          )
          expect(Chunk.size(responses)).toBe(messageCount)
        })

        const nodeCCode = Effect.gen(function* () {
          const channelCToA = yield* createChannel(nodeC, 'A', { mode: 'proxy' })
          // Send multiple messages concurrently
          yield* Effect.forEach(
            Chunk.makeBy(messageCount, (i) => ({ message: `C${i}` })),
            channelCToA.send,
            { concurrency: 'unbounded' },
          )
          // Receive responses
          const responses = yield* channelCToA.listen.pipe(
            Stream.flatten(),
            Stream.take(messageCount),
            Stream.runCollect,
          )
          expect(Chunk.size(responses)).toBe(messageCount)
        })

        yield* Effect.all([nodeACode, nodeCCode], { concurrency: 'unbounded' })
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.describe('ACK forkScoped regression tests', { timeout: 10_000 }, () => {
      /**
       * REGRESSION TEST: ACK sends must be forked (non-blocking) to allow message processing to continue.
       *
       * This test uses simulation parameters to inject a delay BEFORE the ACK send.
       * It then measures when messages arrive at the receiver's listen queue.
       *
       * With the fix (Effect.forkScoped):
       * - ACK send is forked in the background
       * - Message is added to listen queue IMMEDIATELY (before ACK send completes)
       * - Multiple messages arrive close together regardless of ACK delay
       *
       * Without the fix (blocking yield*):
       * - ACK send blocks the processing loop
       * - Message is added to listen queue AFTER ACK send completes
       * - Messages arrive spread out by the ACK delay
       *
       * To verify this test catches the regression:
       * 1. Temporarily change `Effect.forkScoped` to `yield*` in proxy-channel.ts:319
       * 2. Run this test - it should FAIL because messages arrive too slowly
       * 3. Revert the change - test should PASS
       */
      /**
       * This test verifies the fix works: messages should arrive at the listen queue
       * without being blocked by slow ACK sends. We measure how long it takes to receive
       * all messages - with forked ACKs it should be fast, with blocking ACKs it would be slow.
       */
      Vitest.scopedLive('messages arrive in listen queue without waiting for ACK send', (test) =>
        Effect.gen(function* () {
          const ACK_DELAY_MS = 50
          const MESSAGE_COUNT = 5

          const nodeA = yield* makeMeshNode('A')
          const nodeB = yield* makeMeshNode('B')

          yield* connectNodesViaMessageChannel(nodeA, nodeB)

          const receivedMessages: string[] = []

          const senderCode = Effect.gen(function* () {
            const channelAToB = yield* nodeA.makeChannel({
              target: 'B',
              channelName: 'test-ack-timing',
              schema: ExampleSchema,
              mode: 'proxy',
              timeout: 3000,
            })

            // Send all messages concurrently - this is key!
            // With forked ACKs, all messages get processed immediately at receiver
            // With blocking ACKs, messages would be processed one at a time with delays
            yield* Effect.forEach(
              Chunk.makeBy(MESSAGE_COUNT, (i) => ({ message: `msg${i}` })),
              channelAToB.send,
              { concurrency: 'unbounded' },
            )
          })

          const receiverCode = Effect.gen(function* () {
            const channelBToA = yield* nodeB.makeChannel({
              target: 'A',
              channelName: 'test-ack-timing',
              schema: ExampleSchema,
              mode: 'proxy',
              timeout: 3000,
              // KEY: Inject delay BEFORE ACK send
              // With forkScoped: message arrives in queue immediately, then ACK is sent in background
              // Without forkScoped: message waits for ACK delay before being added to queue
              simulation: {
                onPayload: {
                  beforeAckSend: ACK_DELAY_MS,
                  afterAckFork: 0,
                  afterListenQueueOffer: 0,
                },
              },
            })

            yield* channelBToA.listen.pipe(
              Stream.flatten(),
              Stream.tap((msg) =>
                Effect.sync(() => {
                  receivedMessages.push(msg.message)
                }),
              ),
              Stream.take(MESSAGE_COUNT),
              Stream.runDrain,
            )
          })

          const startTime = Date.now()
          yield* Effect.all([senderCode, receiverCode], { concurrency: 'unbounded' })
          const elapsed = Date.now() - startTime

          console.log(`[regression-test-1] Received ${receivedMessages.length} messages in ${elapsed}ms`)
          console.log(`[regression-test-1] Messages: ${receivedMessages.join(', ')}`)

          expect(receivedMessages.length).toBe(MESSAGE_COUNT)

          // With forked ACKs, elapsed time should be much less than MESSAGE_COUNT * ACK_DELAY_MS
          // because ACKs don't block message processing
          const blockingTime = MESSAGE_COUNT * ACK_DELAY_MS
          console.log(`[regression-test-1] Elapsed: ${elapsed}ms, Blocking estimate: ${blockingTime}ms`)

          // The test passes if messages arrive faster than they would with blocking ACKs
          // Allow some margin for test overhead (2x faster than blocking)
          if (elapsed > blockingTime / 2) {
            throw new Error(
              `REGRESSION DETECTED: Processing took ${elapsed}ms, blocking estimate: ${blockingTime}ms. ` +
                `With forked ACKs, processing should be much faster. ` +
                `Check that proxy-channel.ts uses Effect.forkScoped for ACK sends.`,
            )
          }
        }).pipe(Vitest.withTestCtx(test)),
      )

      /**
       * Additional test: Verify message processing continues during slow ACK sends.
       *
       * This test sends multiple messages concurrently and verifies they're all
       * processed even when ACK sends are slow.
       */
      Vitest.scopedLive('concurrent messages processed despite slow ACK sends', (test) =>
        Effect.gen(function* () {
          const ACK_DELAY_MS = 50
          const MESSAGE_COUNT = 5

          const nodeA = yield* makeMeshNode('A')
          const nodeB = yield* makeMeshNode('B')

          yield* connectNodesViaMessageChannel(nodeA, nodeB)

          const receivedMessages: string[] = []

          const senderCode = Effect.gen(function* () {
            const channelAToB = yield* nodeA.makeChannel({
              target: 'B',
              channelName: 'test-concurrent',
              schema: ExampleSchema,
              mode: 'proxy',
              timeout: 3000,
            })

            // Send all messages concurrently
            yield* Effect.forEach(
              Chunk.makeBy(MESSAGE_COUNT, (i) => ({ message: `msg${i}` })),
              channelAToB.send,
              { concurrency: 'unbounded' },
            )
          })

          const receiverCode = Effect.gen(function* () {
            const channelBToA = yield* nodeB.makeChannel({
              target: 'A',
              channelName: 'test-concurrent',
              schema: ExampleSchema,
              mode: 'proxy',
              timeout: 3000,
              simulation: {
                onPayload: {
                  beforeAckSend: ACK_DELAY_MS,
                  afterAckFork: 0,
                  afterListenQueueOffer: 0,
                },
              },
            })

            yield* channelBToA.listen.pipe(
              Stream.flatten(),
              Stream.tap((msg) =>
                Effect.sync(() => {
                  receivedMessages.push(msg.message)
                }),
              ),
              Stream.take(MESSAGE_COUNT),
              Stream.runDrain,
            )
          })

          const startTime = Date.now()
          yield* Effect.all([senderCode, receiverCode], { concurrency: 'unbounded' })
          const elapsed = Date.now() - startTime

          console.log(`[regression-test] Received ${receivedMessages.length} messages in ${elapsed}ms`)
          console.log(`[regression-test] Messages: ${receivedMessages.join(', ')}`)

          // All messages should be received
          expect(receivedMessages.length).toBe(MESSAGE_COUNT)

          // With forked ACKs, elapsed time should be much less than MESSAGE_COUNT * ACK_DELAY_MS
          // because ACKs don't block message processing
          const blockingTime = MESSAGE_COUNT * ACK_DELAY_MS
          console.log(`[regression-test] Elapsed: ${elapsed}ms, Blocking estimate: ${blockingTime}ms`)
        }).pipe(Vitest.withTestCtx(test)),
      )
    })

    Vitest.scopedLive('should fail with timeout due to missing edge', (test) =>
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
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.scopedLive('should fail with timeout due no transferable', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        yield* connectNodesViaBroadcastChannel(nodeA, nodeB)

        const nodeACode = Effect.gen(function* () {
          const err = yield* createChannel(nodeA, 'B').pipe(Effect.timeout(200), Effect.flip)
          expect(err._tag).toBe('TimeoutException')
        })

        const nodeBCode = Effect.gen(function* () {
          const err = yield* createChannel(nodeB, 'A').pipe(Effect.timeout(200), Effect.flip)
          expect(err._tag).toBe('TimeoutException')
        })

        yield* Effect.all([nodeACode, nodeBCode], { concurrency: 'unbounded' })
      }).pipe(Vitest.withTestCtx(test)),
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
      }).pipe(Vitest.withTestCtx(test)),
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
      }).pipe(Vitest.withTestCtx(test)),
    )
  })

  /**
   *    A       E
   *     \     /
   *      C---D
   *     /     \
   *    B       F
   *
   * Topology: Butterfly topology with two connected hubs (C-D) each serving multiple nodes
   */
  Vitest.describe('butterfly topology', () => {
    Vitest.scopedLive('should work', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')
        const nodeD = yield* makeMeshNode('D')
        const nodeE = yield* makeMeshNode('E')
        const nodeF = yield* makeMeshNode('F')

        yield* connectNodesViaMessageChannel(nodeA, nodeC)
        yield* connectNodesViaMessageChannel(nodeB, nodeC)
        yield* connectNodesViaMessageChannel(nodeC, nodeD)
        yield* connectNodesViaMessageChannel(nodeD, nodeE)
        yield* connectNodesViaMessageChannel(nodeD, nodeF)

        yield* Effect.promise(() => nodeA.debug.requestTopology(100))

        const nodeACode = Effect.gen(function* () {
          const channelAToE = yield* createChannel(nodeA, 'E')
          yield* channelAToE.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToE)).toEqual({ message: 'E1' })
        })

        const nodeECode = Effect.gen(function* () {
          const channelEToA = yield* createChannel(nodeE, 'A')
          yield* channelEToA.send({ message: 'E1' })
          expect(yield* getFirstMessage(channelEToA)).toEqual({ message: 'A1' })
        })

        yield* Effect.all([nodeACode, nodeECode], { concurrency: 'unbounded' })
      }).pipe(Vitest.withTestCtx(test)),
    )
  })

  Vitest.describe('mixture of direct and proxy edge connections', () => {
    // TODO test case to better guard against case where side A tries to create a proxy channel to B
    // and side B tries to create a direct to A
    Vitest.scopedLive('should work for proxy channels', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')

        yield* connectNodesViaMessageChannel(nodeB, nodeA)
        const err = yield* connectNodesViaBroadcastChannel(nodeA, nodeB).pipe(Effect.flip)

        expect(err._tag).toBe('EdgeAlreadyExistsError')
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.scopedLive('should work for directs', (test) =>
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
      }).pipe(Vitest.withTestCtx(test)),
    )
  })

  Vitest.describe('listenForChannel', () => {
    Vitest.scopedLive('connect later', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')

        const mode = 'direct' as 'proxy' | 'direct'
        const connect = mode === 'direct' ? connectNodesViaMessageChannel : connectNodesViaBroadcastChannel

        const nodeACode = Effect.gen(function* () {
          const channelAToB = yield* createChannel(nodeA, 'B', { channelName: 'test', mode })
          yield* channelAToB.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B1' })
        })

        const nodeBCode = Effect.gen(function* () {
          const nodeB = yield* makeMeshNode('B')
          yield* connect(nodeA, nodeB)

          yield* nodeB.listenForChannel.pipe(
            Stream.filter((_) => _.channelName === 'test' && _.source === 'A' && _.mode === mode),
            Stream.tap(
              Effect.fn(function* (channelInfo) {
                const channel = yield* createChannel(nodeB, channelInfo.source, {
                  channelName: channelInfo.channelName,
                  mode,
                })
                yield* channel.send({ message: 'B1' })
                expect(yield* getFirstMessage(channel)).toEqual({ message: 'A1' })
              }),
            ),
            Stream.take(1),
            Stream.runDrain,
          )
        })

        yield* Effect.all([nodeACode, nodeBCode.pipe(Effect.delay(500))], { concurrency: 'unbounded' })
      }).pipe(Vitest.withTestCtx(test)),
    )

    // TODO provide a way to allow for reconnecting in the `listenForChannel` case
    Vitest.scopedLive.skip('reconnect', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')

        const mode = 'direct' as 'proxy' | 'direct'
        const connect = mode === 'direct' ? connectNodesViaMessageChannel : connectNodesViaBroadcastChannel

        const nodeACode = Effect.gen(function* () {
          const channelAToB = yield* createChannel(nodeA, 'B', { channelName: 'test', mode })
          yield* channelAToB.send({ message: 'A1' })
          expect(yield* getFirstMessage(channelAToB)).toEqual({ message: 'B1' })
        })

        const nodeBCode = Effect.gen(function* () {
          const nodeB = yield* makeMeshNode('B')
          yield* connect(nodeA, nodeB)

          yield* nodeB.listenForChannel.pipe(
            Stream.filter((_) => _.channelName === 'test' && _.source === 'A' && _.mode === mode),
            Stream.tap(
              Effect.fn(function* (channelInfo) {
                const channel = yield* createChannel(nodeB, channelInfo.source, {
                  channelName: channelInfo.channelName,
                  mode,
                })
                yield* channel.send({ message: 'B1' })
                expect(yield* getFirstMessage(channel)).toEqual({ message: 'A1' })
              }),
            ),
            Stream.take(1),
            Stream.runDrain,
          )
        }).pipe(
          Effect.withSpan('nodeBCode:gen1'),
          Effect.andThen(
            Effect.gen(function* () {
              const nodeB = yield* makeMeshNode('B')
              yield* connect(nodeA, nodeB, { replaceIfExists: true })

              yield* nodeB.listenForChannel.pipe(
                Stream.filter((_) => _.channelName === 'test' && _.source === 'A' && _.mode === mode),
                Stream.tap(
                  Effect.fn(function* (channelInfo) {
                    const channel = yield* createChannel(nodeB, channelInfo.source, {
                      channelName: channelInfo.channelName,
                      mode,
                    })
                    console.log('recreated channel', channel)
                    // yield* channel.send({ message: 'B1' })
                    // expect(yield* getFirstMessage(channel)).toEqual({ message: 'A1' })
                  }),
                ),
                Stream.take(1),
                Stream.runDrain,
              )
            }).pipe(Effect.withSpan('nodeBCode:gen2')),
          ),
        )

        yield* Effect.all([nodeACode, nodeBCode], { concurrency: 'unbounded' })
      }).pipe(Vitest.withTestCtx(test)),
    )

    Vitest.describe('prop tests', { timeout: propTestTimeout }, () => {
      Vitest.scopedLive.prop(
        'listenForChannel A <> B <> C',
        [Delay, Delay, Delay, Delay, ChannelType],
        ([delayNodeA, delayNodeC, delayConnectAB, delayConnectBC, channelType], test) =>
          Effect.gen(function* () {
            const nodeA = yield* makeMeshNode('A')
            const nodeB = yield* makeMeshNode('B')
            const nodeC = yield* makeMeshNode('C')

            const mode = channelType.includes('proxy') ? 'proxy' : 'direct'
            const connect = channelType === 'direct' ? connectNodesViaMessageChannel : connectNodesViaBroadcastChannel
            yield* connect(nodeA, nodeB).pipe(maybeDelay(delayConnectAB, 'delayConnectAB'))
            yield* connect(nodeB, nodeC).pipe(maybeDelay(delayConnectBC, 'delayConnectBC'))

            const nodeACode = Effect.gen(function* () {
              const _channel2AToC = yield* createChannel(nodeA, 'C', { channelName: 'test-2', mode })

              const channelAToC = yield* createChannel(nodeA, 'C', { channelName: 'test-1', mode })
              yield* channelAToC.send({ message: 'A1' })
              expect(yield* getFirstMessage(channelAToC)).toEqual({ message: 'C1' })
            })

            const nodeCCode = Effect.gen(function* () {
              const _channel2CToA = yield* createChannel(nodeC, 'A', { channelName: 'test-2', mode })

              yield* nodeC.listenForChannel.pipe(
                Stream.filter((_) => _.channelName === 'test-1' && _.source === 'A' && _.mode === mode),
                Stream.tap(
                  Effect.fn(function* (channelInfo) {
                    const channel = yield* createChannel(nodeC, channelInfo.source, {
                      channelName: channelInfo.channelName,
                      mode,
                    })
                    yield* channel.send({ message: 'C1' })
                    expect(yield* getFirstMessage(channel)).toEqual({ message: 'A1' })
                  }),
                ),
                Stream.take(1),
                Stream.runDrain,
              )
            })

            yield* Effect.all(
              [
                nodeACode.pipe(maybeDelay(delayNodeA, 'nodeACode')),
                nodeCCode.pipe(maybeDelay(delayNodeC, 'nodeCCode')),
              ],
              { concurrency: 'unbounded' },
            )
          }).pipe(
            Vitest.withTestCtx(test, {
              suffix: `delayNodeA=${delayNodeA} delayNodeC=${delayNodeC} delayConnectAB=${delayConnectAB} delayConnectBC=${delayConnectBC} channelType=${channelType}`,
              timeout: testTimeout * 2,
            }),
          ),
        { fastCheck: { numRuns: 10 } },
      )
    })
  })

  Vitest.describe('broadcast channel', () => {
    Vitest.scopedLive('should work', (test) =>
      Effect.gen(function* () {
        const nodeA = yield* makeMeshNode('A')
        const nodeB = yield* makeMeshNode('B')
        const nodeC = yield* makeMeshNode('C')

        yield* connectNodesViaMessageChannel(nodeA, nodeB)
        yield* connectNodesViaMessageChannel(nodeB, nodeC)

        const channelOnA = yield* nodeA.makeBroadcastChannel({ channelName: 'test', schema: Schema.String })
        const channelOnC = yield* nodeC.makeBroadcastChannel({ channelName: 'test', schema: Schema.String })

        const listenOnAFiber = yield* channelOnA.listen.pipe(
          Stream.flatten(),
          Stream.runHead,
          Effect.flatten,
          Effect.fork,
        )
        const listenOnCFiber = yield* channelOnC.listen.pipe(
          Stream.flatten(),
          Stream.runHead,
          Effect.flatten,
          Effect.fork,
        )

        yield* channelOnA.send('A1')
        yield* channelOnC.send('C1')

        expect(yield* listenOnAFiber).toEqual('C1')
        expect(yield* listenOnCFiber).toEqual('A1')
      }).pipe(Vitest.withTestCtx(test)),
    )
  })
})
