import { Effect, Stream } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'
import { events, makeTodoMvc } from '../utils/tests/fixture.ts'

Vitest.describe('Store events API', () => {
  Vitest.scopedLive('should stream events with filtering', () =>
    Effect.gen(function* () {
      const store = yield* makeTodoMvc()

      store.commit(
        events.todoCreated({ id: '1', text: 'Test todo', completed: false }),
        events.todoCreated({ id: '2', text: 'Test todo 2', completed: false }),
      )

      const collected: any[] = []
      yield* store
        .eventsStream({
          filter: ['todo.created'],
          snapshotOnly: true,
        })
        .pipe(
          Stream.tapSync((event) => collected.push(event)),
          Stream.runDrain,
        )

      expect(collected).toHaveLength(2)
    }),
  )
})

// // Mock sync processor for testing
// const createMockSyncProcessor = () => {
//   const pendingEvents: LiveStoreEvent.EncodedWithMeta[] = []
//   let currentHead = EventSequenceNumber.ROOT

//   const subscribers: Array<(state: any) => void> = []

//   const syncState = {
//     get: Effect.succeed({
//       pending: pendingEvents,
//       localHead: currentHead,
//       upstreamHead: EventSequenceNumber.ROOT,
//     }),
//     changes: Stream.async<any>((emit) => {
//       subscribers.push((state) => emit.single(state))
//     }),
//     current: {
//       pending: pendingEvents,
//       localHead: currentHead,
//       upstreamHead: EventSequenceNumber.ROOT,
//     },
//   }

//   const addEvent = (event: LiveStoreEvent.EncodedWithMeta) => {
//     pendingEvents.push(event)
//     currentHead = event.seqNum
//     syncState.current = {
//       pending: [...pendingEvents],
//       localHead: currentHead,
//       upstreamHead: EventSequenceNumber.ROOT,
//     }
//     // Notify subscribers
//     subscribers.forEach((sub) => sub(syncState.current))
//   }

//   return {
//     syncState,
//     addEvent,
//   }
// }

// describe('Store events API', () => {
//   describe('events()', () => {
//     it('should return an async iterable', async () => {
//       const mockSyncProcessor = createMockSyncProcessor()
//       const store = {
//         syncProcessor: mockSyncProcessor,
//         schema: {
//           _EventDefMapType: {
//             todoCreated: {},
//             todoCompleted: {},
//           },
//         },
//         eventsStream: vi.fn().mockReturnValue(Stream.empty),
//       } as any as Store

//       // Override eventsStream to use our implementation
//       store.eventsStream = (_options?: StoreEventsOptions<any>) => {
//         return Stream.fromIterable(mockSyncProcessor.syncState.current.pending)
//       }

//       const events = store.events()
//       expect(events).toHaveProperty(Symbol.asyncIterator as any)
//       expect(typeof events[Symbol.asyncIterator]).toBe('function')
//     })

//     it('should iterate over events from the stream', async () => {
//       const mockEvents = [
//         LiveStoreEvent.EncodedWithMeta.make({
//           name: 'todoCreated',
//           args: { id: '1', text: 'Test todo' },
//           seqNum: {
//             global: 1 as any as EventSequenceNumber.GlobalEventSequenceNumber,
//             client: 1 as any as EventSequenceNumber.ClientEventSequenceNumber,
//             rebaseGeneration: 0,
//           },
//           parentSeqNum: EventSequenceNumber.ROOT,
//           clientId: 'test-client',
//           sessionId: 'test-session',
//           meta: {
//             sessionChangeset: { _tag: 'unset' },
//             syncMetadata: Option.none(),
//             materializerHashLeader: Option.none(),
//             materializerHashSession: Option.none(),
//           },
//         }),
//       ]

//       const store = {
//         eventsStream: vi.fn().mockReturnValue(Stream.fromIterable(mockEvents)),
//       } as any as Store

//       const collectedEvents = []
//       for await (const event of store.events()) {
//         collectedEvents.push(event)
//       }

//       expect(collectedEvents).toHaveLength(1)
//       expect(store.eventsStream).toHaveBeenCalledWith(undefined)
//     })
//   })

//   describe('eventsStream()', () => {
//     it('should emit new events as they are added', async () => {
//       const mockSyncProcessor = createMockSyncProcessor()
//       const mockSchema = {
//         _EventDefMapType: {
//           todoCreated: {},
//         },
//       }

//       const eventSchema = Schema.Struct({
//         name: Schema.String,
//         args: Schema.Any,
//         seqNum: EventSequenceNumber.EventSequenceNumber,
//         parentSeqNum: EventSequenceNumber.EventSequenceNumber,
//         clientId: Schema.String,
//         sessionId: Schema.String,
//       })

//       vi.spyOn(LiveStoreEvent, 'makeEventDefSchemaMemo').mockReturnValue(eventSchema as any)

//       const store = {
//         syncProcessor: mockSyncProcessor,
//         schema: mockSchema,
//         clientSession: { sessionId: 'test-session', clientId: 'test-client' },
//       } as any as Store

//       // Collect events from the stream
//       const collectedEvents: any[] = []
//       const fiber = store.eventsStream().pipe(
//         Stream.tap((event) => Effect.sync(() => collectedEvents.push(event))),
//         Stream.take(2),
//         Stream.runDrain,
//         Effect.runFork,
//       )

//       // Add events after stream is running
//       await new Promise((resolve) => setTimeout(resolve, 10))

//       mockSyncProcessor.addEvent(
//         LiveStoreEvent.EncodedWithMeta.make({
//           name: 'todoCreated',
//           args: { id: '1', text: 'First todo' },
//           seqNum: {
//             global: 1 as any as EventSequenceNumber.GlobalEventSequenceNumber,
//             client: 1 as any as EventSequenceNumber.ClientEventSequenceNumber,
//             rebaseGeneration: 0,
//           },
//           parentSeqNum: EventSequenceNumber.ROOT,
//           clientId: 'test-client',
//           sessionId: 'test-session',
//           meta: {
//             sessionChangeset: { _tag: 'unset' },
//             syncMetadata: Option.none(),
//             materializerHashLeader: Option.none(),
//             materializerHashSession: Option.none(),
//           },
//         }),
//       )

//       mockSyncProcessor.addEvent(
//         LiveStoreEvent.EncodedWithMeta.make({
//           name: 'todoCreated',
//           args: { id: '2', text: 'Second todo' },
//           seqNum: {
//             global: 2 as any as EventSequenceNumber.GlobalEventSequenceNumber,
//             client: 2 as any as EventSequenceNumber.ClientEventSequenceNumber,
//             rebaseGeneration: 0,
//           },
//           parentSeqNum: {
//             global: 1 as any as EventSequenceNumber.GlobalEventSequenceNumber,
//             client: 1 as any as EventSequenceNumber.ClientEventSequenceNumber,
//             rebaseGeneration: 0,
//           },
//           clientId: 'test-client',
//           sessionId: 'test-session',
//           meta: {
//             sessionChangeset: { _tag: 'unset' },
//             syncMetadata: Option.none(),
//             materializerHashLeader: Option.none(),
//             materializerHashSession: Option.none(),
//           },
//         }),
//       )

//       await Effect.runPromise(fiber.await)

//       expect(collectedEvents).toHaveLength(2)
//       expect(collectedEvents[0].name).toBe('todoCreated')
//       expect(collectedEvents[0].args.id).toBe('1')
//       expect(collectedEvents[1].args.id).toBe('2')
//     })

//     it('should filter events by name when filter option is provided', async () => {
//       const mockSyncProcessor = createMockSyncProcessor()
//       const mockSchema = {
//         _EventDefMapType: {
//           todoCreated: {},
//           todoCompleted: {},
//           todoDeleted: {},
//         },
//       }

//       // Mock getEventDef to return appropriate event definitions
//       vi.doMock('@livestore/common/schema', () => ({
//         getEventDef: (_schema: any, _name: string) => ({
//           eventDef: { options: { clientOnly: false } },
//         }),
//       }))

//       const store = {
//         syncProcessor: mockSyncProcessor,
//         schema: mockSchema,
//         clientSession: { sessionId: 'test-session', clientId: 'test-client' },
//       } as any as Store

//       // Pre-populate with mixed events
//       const events = [
//         { name: 'todoCreated', args: { id: '1' } },
//         { name: 'todoCompleted', args: { id: '1' } },
//         { name: 'todoDeleted', args: { id: '1' } },
//         { name: 'todoCreated', args: { id: '2' } },
//       ].map((event, i) =>
//         LiveStoreEvent.EncodedWithMeta.make({
//           ...event,
//           seqNum: {
//             global: (i + 1) as any as EventSequenceNumber.GlobalEventSequenceNumber,
//             client: (i + 1) as any as EventSequenceNumber.ClientEventSequenceNumber,
//             rebaseGeneration: 0,
//           },
//           parentSeqNum:
//             i === 0
//               ? EventSequenceNumber.ROOT
//               : {
//                   global: i as any as EventSequenceNumber.GlobalEventSequenceNumber,
//                   client: i as any as EventSequenceNumber.ClientEventSequenceNumber,
//                   rebaseGeneration: 0,
//                 },
//           clientId: 'test-client',
//           sessionId: 'test-session',
//           meta: {
//             sessionChangeset: { _tag: 'unset' },
//             syncMetadata: Option.none(),
//             materializerHashLeader: Option.none(),
//             materializerHashSession: Option.none(),
//           },
//         }),
//       )

//       events.forEach((e) => mockSyncProcessor.addEvent(e))

//       // Collect only todoCreated events
//       const collectedEvents: any[] = []
//       await store.eventsStream({ filter: ['todoCreated'] }).pipe(
//         Stream.tap((event) => Effect.sync(() => collectedEvents.push(event))),
//         Stream.take(2),
//         Stream.runDrain,
//         Effect.runPromise,
//       )

//       expect(collectedEvents).toHaveLength(2)
//       expect(collectedEvents.every((e) => e.name === 'todoCreated')).toBe(true)
//     })

//     it('should start from cursor position when provided', async () => {
//       const mockSyncProcessor = createMockSyncProcessor()
//       const mockSchema = {
//         _EventDefMapType: {
//           todoCreated: {},
//         },
//       }

//       const store = {
//         syncProcessor: mockSyncProcessor,
//         schema: mockSchema,
//         clientSession: { sessionId: 'test-session', clientId: 'test-client' },
//       } as any as Store

//       // Add some initial events
//       for (let i = 1; i <= 5; i++) {
//         mockSyncProcessor.addEvent(
//           LiveStoreEvent.EncodedWithMeta.make({
//             name: 'todoCreated',
//             args: { id: `${i}` },
//             seqNum: {
//               global: i as any as EventSequenceNumber.GlobalEventSequenceNumber,
//               client: i as any as EventSequenceNumber.ClientEventSequenceNumber,
//               rebaseGeneration: 0,
//             },
//             parentSeqNum:
//               i === 1
//                 ? EventSequenceNumber.ROOT
//                 : {
//                     global: (i - 1) as any as EventSequenceNumber.GlobalEventSequenceNumber,
//                     client: (i - 1) as any as EventSequenceNumber.ClientEventSequenceNumber,
//                     rebaseGeneration: 0,
//                   },
//             clientId: 'test-client',
//             sessionId: 'test-session',
//             meta: {
//               sessionChangeset: { _tag: 'unset' },
//               syncMetadata: Option.none(),
//               materializerHashLeader: Option.none(),
//               materializerHashSession: Option.none(),
//             },
//           }),
//         )
//       }

//       // Start from event 3
//       const cursor = {
//         global: 3 as any as EventSequenceNumber.GlobalEventSequenceNumber,
//         client: 3 as any as EventSequenceNumber.ClientEventSequenceNumber,
//         rebaseGeneration: 0,
//       } as EventSequenceNumber.EventSequenceNumber
//       const collectedEvents: any[] = []

//       await store.eventsStream({ cursor }).pipe(
//         Stream.tap((event) => Effect.sync(() => collectedEvents.push(event))),
//         Stream.take(2),
//         Stream.runDrain,
//         Effect.runPromise,
//       )

//       // Should only get events 4 and 5
//       expect(collectedEvents).toHaveLength(2)
//       expect(collectedEvents[0].args.id).toBe('4')
//       expect(collectedEvents[1].args.id).toBe('5')
//     })
//   })
// })
