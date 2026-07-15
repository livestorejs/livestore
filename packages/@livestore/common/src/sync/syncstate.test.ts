import { assert, expect } from 'vitest'

import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Cause, Effect, Exit, Schema } from '@livestore/utils/effect'

import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import * as SyncState from './syncstate.ts'

const makeTestEvent = ({
  seqNum,
  parentSeqNum,
  payload,
  isClientOnly,
}: {
  seqNum: EventSequenceNumber.Client.CompositeInput
  parentSeqNum: EventSequenceNumber.Client.CompositeInput
  payload: string
  isClientOnly: boolean
}) =>
  new LiveStoreEvent.Client.EncodedWithMeta({
    seqNum: EventSequenceNumber.Client.Composite.make(seqNum),
    parentSeqNum: EventSequenceNumber.Client.Composite.make(parentSeqNum),
    name: 'a',
    // Effect v4 normalizes nested Schema.Class values to their declared schema fields.
    // Keep this test-only flag inside `args`, which is part of EncodedWithMeta,
    // instead of relying on subclass fields that are stripped during parsing.
    args: { payload, isClientOnly },
    clientId: 'static-local-id',
    sessionId: 'static-session-id',
  })

const e0_1 = makeTestEvent({
  seqNum: { global: 0, client: 1 },
  parentSeqNum: EventSequenceNumber.Client.ROOT,
  payload: 'a',
  isClientOnly: true,
})
const e1_0 = makeTestEvent({
  seqNum: { global: 1, client: 0 },
  parentSeqNum: EventSequenceNumber.Client.ROOT,
  payload: 'a',
  isClientOnly: false,
})
const e1_1 = makeTestEvent({
  seqNum: { global: 1, client: 1 },
  parentSeqNum: e1_0.seqNum,
  payload: 'a',
  isClientOnly: true,
})
const e1_2 = makeTestEvent({
  seqNum: { global: 1, client: 2 },
  parentSeqNum: e1_1.seqNum,
  payload: 'a',
  isClientOnly: true,
})
const e1_3 = makeTestEvent({
  seqNum: { global: 1, client: 3 },
  parentSeqNum: e1_2.seqNum,
  payload: 'a',
  isClientOnly: true,
})
const e2_0 = makeTestEvent({
  seqNum: { global: 2, client: 0 },
  parentSeqNum: e1_0.seqNum,
  payload: 'a',
  isClientOnly: false,
})
const e2_1 = makeTestEvent({
  seqNum: { global: 2, client: 1 },
  parentSeqNum: e2_0.seqNum,
  payload: 'a',
  isClientOnly: true,
})

const isEqualEvent = LiveStoreEvent.Client.isEqualEncoded

const isClientOnlyEvent = (event: LiveStoreEvent.Client.EncodedWithMeta) =>
  typeof event.args === 'object' &&
  event.args !== null &&
  'isClientOnly' in event.args &&
  event.args.isClientOnly === true

const rebaseTestEvent = ({
  event,
  parentSeqNum,
  rebaseGeneration,
}: {
  event: LiveStoreEvent.Client.EncodedWithMeta
  parentSeqNum: EventSequenceNumber.Client.Composite
  rebaseGeneration: number
}) => event.rebase({ parentSeqNum, isClientOnly: isClientOnlyEvent(event), rebaseGeneration })

Vitest.describe('syncstate', () => {
  Vitest.describe('merge', () => {
    const merge = ({
      syncState,
      payload,
      ignoreClientOnlyEvents = false,
    }: {
      syncState: SyncState.SyncState
      payload: typeof SyncState.Payload.Type
      ignoreClientOnlyEvents?: boolean
    }) => SyncState.merge({ syncState, payload, isClientOnlyEvent, isEqualEvent, ignoreClientOnlyEvents })

    Vitest.describe('upstream-rebase', () => {
      Vitest.it.effect('should rollback until start', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e2_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e2_0.seqNum,
          })
          const e1_0_e2_0 = rebaseTestEvent({ event: e1_0, parentSeqNum: e2_0.seqNum, rebaseGeneration: 0 })
          const e1_1_e2_1 = rebaseTestEvent({ event: e1_1, parentSeqNum: e1_0_e2_0.seqNum, rebaseGeneration: 0 })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamRebase.make({
              rollbackEvents: [e1_0, e1_1],
              newEvents: [e1_0_e2_0, e1_1_e2_1],
            }),
          })
          const e2_0_e3_0 = rebaseTestEvent({ event: e2_0, parentSeqNum: e1_0_e2_0.seqNum, rebaseGeneration: 1 })
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e2_0_e3_0])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_1_e2_1.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0_e3_0.seqNum)
          expectEventArraysEqual(result.newEvents, [e1_0_e2_0, e1_1_e2_1, e2_0_e3_0])
          expectEventArraysEqual(result.rollbackEvents, [e1_0, e1_1, e2_0])
        }),
      )

      Vitest.it.effect('should rollback only to specified point', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e2_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e2_0.seqNum,
          })
          const e1_1_e2_0 = rebaseTestEvent({ event: e1_1, parentSeqNum: e1_0.seqNum, rebaseGeneration: 0 })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamRebase.make({
              newEvents: [e1_1_e2_0],
              rollbackEvents: [e1_1],
            }),
          })
          const e2_0_e3_0 = rebaseTestEvent({ event: e2_0, parentSeqNum: e1_1_e2_0.seqNum, rebaseGeneration: 1 })
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e2_0_e3_0])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_1_e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0_e3_0.seqNum)
          expectEventArraysEqual(result.newEvents, [e1_1_e2_0, e2_0_e3_0])
          expectEventArraysEqual(result.rollbackEvents, [e1_1, e2_0])
        }),
      )

      Vitest.it.effect('should work for empty pending', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamRebase.make({ rollbackEvents: [e1_0], newEvents: [e2_0] }),
          })
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0.seqNum)
          expectEventArraysEqual(result.newEvents, [e2_0])
        }),
      )
    })

    Vitest.describe('upstream-advance: advance', () => {
      Vitest.it.effect('should die if newEvents are not sorted in ascending order by event number (client)', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const exit = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e1_1, e1_0] } }).pipe(
            Effect.exit,
          )
          assert(Exit.isFailure(exit))
          expect(Cause.hasDies(exit.cause)).toBe(true)
        }),
      )

      Vitest.it.effect('should die if newEvents are not sorted in ascending order by event number (global)', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const exit = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e2_0, e1_0] } }).pipe(
            Effect.exit,
          )
          assert(Exit.isFailure(exit))
          expect(Cause.hasDies(exit.cause)).toBe(true)
        }),
      )

      Vitest.it.effect('should die if incoming event is < expected upstream head', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [],
            upstreamHead: e2_0.seqNum,
            localHead: e2_0.seqNum,
          })
          const exit = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e1_0] } }).pipe(
            Effect.exit,
          )
          assert(Exit.isFailure(exit))
          expect(Cause.hasDies(exit.cause)).toBe(true)
        }),
      )

      Vitest.it.effect('should die if incoming event is = expected upstream head', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [],
            upstreamHead: e2_0.seqNum,
            localHead: e2_0.seqNum,
          })
          const exit = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e2_0] } }).pipe(
            Effect.exit,
          )
          assert(Exit.isFailure(exit))
          expect(Cause.hasDies(exit.cause)).toBe(true)
        }),
      )

      Vitest.it.effect('should confirm pending event when receiving matching event', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e1_0] } })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_0.seqNum)
          expectEventArraysEqual(result.newEvents, [])
          expectEventArraysEqual(result.confirmedEvents, [e1_0])
        }),
      )

      Vitest.it.effect('should confirm partial pending event when receiving matching event', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0, e2_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e2_0.seqNum,
          })
          const result = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e1_0] } })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [e2_0])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0.seqNum)
          expectEventArraysEqual(result.newEvents, [])
          expectEventArraysEqual(result.confirmedEvents, [e1_0])
        }),
      )

      Vitest.it.effect('should confirm pending event and add new event', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: { _tag: 'upstream-advance', newEvents: [e1_0, e1_1] },
          })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_1.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_1.seqNum)
          expectEventArraysEqual(result.newEvents, [e1_1])
          expectEventArraysEqual(result.confirmedEvents, [e1_0])
        }),
      )

      Vitest.it.effect('should confirm pending event and add multiple new events', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_1],
            upstreamHead: e1_0.seqNum,
            localHead: e1_1.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: { _tag: 'upstream-advance', newEvents: [e1_1, e1_2, e1_3, e2_0, e2_1] },
          })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_1.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_1.seqNum)
          expectEventArraysEqual(result.newEvents, [e1_2, e1_3, e2_0, e2_1])
          expectEventArraysEqual(result.confirmedEvents, [e1_1])
        }),
      )

      Vitest.it.effect('should confirm pending global event while keep pending client events', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0, e1_1],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_1.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: { _tag: 'upstream-advance', newEvents: [e1_0] },
          })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [e1_1])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_1.seqNum)
          expectEventArraysEqual(result.newEvents, [])
          expectEventArraysEqual(result.confirmedEvents, [e1_0])
        }),
      )

      Vitest.it.effect('should ignore client events (incoming is subset of pending)', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e0_1, e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: { _tag: 'upstream-advance', newEvents: [e1_0] },
            ignoreClientOnlyEvents: true,
          })
          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_0.seqNum)
          expectEventArraysEqual(result.newEvents, [])
          expectEventArraysEqual(result.confirmedEvents, [e0_1, e1_0])
        }),
      )

      Vitest.it.effect('should ignore client events (incoming is subset of pending case 2)', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e0_1, e1_0, e2_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: { _tag: 'upstream-advance', newEvents: [e1_0] },
            ignoreClientOnlyEvents: true,
          })
          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [e2_0])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0.seqNum)
          expectEventArraysEqual(result.newEvents, [])
          expectEventArraysEqual(result.confirmedEvents, [e0_1, e1_0])
        }),
      )

      Vitest.it.effect('should ignore client events (incoming goes beyond pending)', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e0_1, e1_0, e1_1],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_1.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: { _tag: 'upstream-advance', newEvents: [e1_0, e2_0] },
            ignoreClientOnlyEvents: true,
          })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0.seqNum)
          expectEventArraysEqual(result.newEvents, [e2_0])
          expectEventArraysEqual(result.confirmedEvents, [e0_1, e1_0, e1_1])
        }),
      )

      Vitest.it.effect('should die if incoming event is ≤ local head', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [],
            upstreamHead: e2_0.seqNum,
            localHead: e2_0.seqNum,
          })
          const exit = yield* merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e1_0] } }).pipe(
            Effect.exit,
          )
          assert(Exit.isFailure(exit))
          expect(Cause.hasDies(exit.cause)).toBe(true)
        }),
      )

      Vitest.it.effect(
        'should advance (not rebase) when pending event has undefined-valued key dropped by JSON wire round-trip',
        () =>
          Effect.gen(function* () {
            const argsSchema = Schema.Struct({
              id: Schema.String,
              flag: Schema.optional(Schema.Boolean),
            })
            const localArgs = Schema.encodeUnknownSync(argsSchema)({ id: 'abc' } as any)
            const wireArgs = JSON.parse(JSON.stringify(localArgs))

            const localPending = new LiveStoreEvent.Client.EncodedWithMeta({
              seqNum: e1_0.seqNum,
              parentSeqNum: e1_0.parentSeqNum,
              name: e1_0.name,
              args: localArgs,
              clientId: e1_0.clientId,
              sessionId: e1_0.sessionId,
            })
            const fromUpstream = new LiveStoreEvent.Client.EncodedWithMeta({
              seqNum: e1_0.seqNum,
              parentSeqNum: e1_0.parentSeqNum,
              name: e1_0.name,
              args: wireArgs,
              clientId: e1_0.clientId,
              sessionId: e1_0.sessionId,
            })

            const syncState = new SyncState.SyncState({
              pending: [localPending],
              upstreamHead: EventSequenceNumber.Client.ROOT,
              localHead: localPending.seqNum,
            })
            const result = yield* merge({
              syncState,
              payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [fromUpstream] }),
            })

            expectAdvance(result)
            expect(result.confirmedEvents).toHaveLength(1)
            expect(result.newSyncState.pending).toHaveLength(0)
          }),
      )
    })

    Vitest.describe('upstream-advance: rebase', () => {
      Vitest.it.effect('should rebase single client event to end', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e1_1] }),
          })

          const e1_0_e1_2 = rebaseTestEvent({ event: e1_0, parentSeqNum: e1_1.seqNum, rebaseGeneration: 1 })

          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e1_0_e1_2])
          expect(result.newSyncState.upstreamHead).toMatchObject(e1_1.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_0_e1_2.seqNum)
          expectEventArraysEqual(result.rollbackEvents, [e1_0])
          expectEventArraysEqual(result.newEvents, [e1_1, e1_0_e1_2])
        }),
      )

      Vitest.it.effect('should rebase different event with same id', () =>
        Effect.gen(function* () {
          const e2_0_b = makeTestEvent({
            seqNum: { global: 1, client: 0 },
            parentSeqNum: e1_0.seqNum,
            payload: '1_0_b',
            isClientOnly: false,
          })
          const syncState = new SyncState.SyncState({
            pending: [e2_0_b],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e2_0_b.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e2_0] }),
          })
          const e2_0_e3_0 = rebaseTestEvent({ event: e2_0_b, parentSeqNum: e2_0.seqNum, rebaseGeneration: 1 })

          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e2_0_e3_0])
          expectEventArraysEqual(result.newEvents, [e2_0, e2_0_e3_0])
          expectEventArraysEqual(result.rollbackEvents, [e2_0_b])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0_e3_0.seqNum)
        }),
      )

      Vitest.it.effect('should rebase single client event to end (more incoming events)', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e1_1, e1_2, e1_3, e2_0] }),
          })

          const e1_0_e3_0 = rebaseTestEvent({ event: e1_0, parentSeqNum: e2_0.seqNum, rebaseGeneration: 1 })

          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e1_0_e3_0])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_0_e3_0.seqNum)
        }),
      )

      Vitest.it.effect('should only rebase divergent events when first event matches', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0, e1_1],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_0.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e1_0, e1_2, e1_3, e2_0] }),
          })

          const e1_1_e2_1 = rebaseTestEvent({ event: e1_1, parentSeqNum: e2_0.seqNum, rebaseGeneration: 1 })

          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e1_1_e2_1])
          expectEventArraysEqual(result.rollbackEvents, [e1_1])
          expectEventArraysEqual(result.newEvents, [e1_2, e1_3, e2_0, e1_1_e2_1])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_1_e2_1.seqNum)
        }),
      )

      Vitest.it.effect('should rebase all client events when incoming chain starts differently', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e1_0, e1_1],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e1_1.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e1_1, e1_2, e1_3, e2_0] }),
          })

          const e1_0_e2_1 = rebaseTestEvent({ event: e1_0, parentSeqNum: e2_0.seqNum, rebaseGeneration: 1 })
          const e1_1_e2_2 = rebaseTestEvent({ event: e1_1, parentSeqNum: e1_0_e2_1.seqNum, rebaseGeneration: 1 })

          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e1_0_e2_1, e1_1_e2_2])
          expectEventArraysEqual(result.newEvents, [e1_1, e1_2, e1_3, e2_0, e1_0_e2_1, e1_1_e2_2])
          expectEventArraysEqual(result.rollbackEvents, [e1_0, e1_1])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e1_1_e2_2.seqNum)
        }),
      )

      Vitest.describe('local-push', () => {
        Vitest.describe('advance', () => {
          Vitest.it.effect('should advance with new events', () =>
            Effect.gen(function* () {
              const syncState = new SyncState.SyncState({
                pending: [e1_0],
                upstreamHead: EventSequenceNumber.Client.ROOT,
                localHead: e1_0.seqNum,
              })
              const result = yield* merge({
                syncState,
                payload: SyncState.PayloadLocalPush.make({ newEvents: [e1_1, e1_2, e1_3] }),
              })

              expectAdvance(result)
              expectEventArraysEqual(result.newSyncState.pending, [e1_0, e1_1, e1_2, e1_3])
              expect(result.newSyncState.upstreamHead).toMatchObject(EventSequenceNumber.Client.ROOT)
              expect(result.newSyncState.localHead).toMatchObject(e1_3.seqNum)
              expectEventArraysEqual(result.newEvents, [e1_1, e1_2, e1_3])
              expectEventArraysEqual(result.confirmedEvents, [])
            }),
          )

          // Leaders can choose to ignore client-only events while still returning them for broadcast.
          // Ensure pending/local head only reflects events that must be pushed upstream.
          Vitest.it.effect('keeps pending empty when pushing only client-only events that are being ignored', () =>
            Effect.gen(function* () {
              const syncState = new SyncState.SyncState({
                pending: [],
                upstreamHead: EventSequenceNumber.Client.ROOT,
                localHead: EventSequenceNumber.Client.ROOT,
              })

              const result = yield* merge({
                syncState,
                payload: SyncState.PayloadLocalPush.make({ newEvents: [e0_1] }),
                ignoreClientOnlyEvents: true,
              })

              expectAdvance(result)
              expectEventArraysEqual(result.newSyncState.pending, [])
              expect(result.newSyncState.upstreamHead).toMatchObject(EventSequenceNumber.Client.ROOT)
              expect(result.newSyncState.localHead).toMatchObject(EventSequenceNumber.Client.ROOT)
              expectEventArraysEqual(result.newEvents, [e0_1])
            }),
          )

          Vitest.it.effect('appends only upstream-bound events to pending when ignoring client-only pushes', () =>
            Effect.gen(function* () {
              const syncState = new SyncState.SyncState({
                pending: [],
                upstreamHead: EventSequenceNumber.Client.ROOT,
                localHead: EventSequenceNumber.Client.ROOT,
              })

              const result = yield* merge({
                syncState,
                payload: SyncState.PayloadLocalPush.make({ newEvents: [e0_1, e1_0] }),
                ignoreClientOnlyEvents: true,
              })

              expectAdvance(result)
              expectEventArraysEqual(result.newSyncState.pending, [e1_0])
              expect(result.newSyncState.upstreamHead).toMatchObject(EventSequenceNumber.Client.ROOT)
              expect(result.newSyncState.localHead).toMatchObject(e1_0.seqNum)
              expectEventArraysEqual(result.newEvents, [e0_1, e1_0])
            }),
          )
        })

        Vitest.describe('reject', () => {
          Vitest.it.effect('should reject when new events are greater than pending events', () =>
            Effect.gen(function* () {
              const syncState = new SyncState.SyncState({
                pending: [e1_0, e1_1],
                upstreamHead: EventSequenceNumber.Client.ROOT,
                localHead: e1_1.seqNum,
              })
              const result = yield* merge({
                syncState,
                payload: SyncState.PayloadLocalPush.make({ newEvents: [e1_1, e1_2] }),
              })

              expectReject(result)
              expect(result.expectedMinimumId).toMatchObject(e1_2.seqNum)
            }),
          )
        })
      })
    })
  })
})

const expectEventArraysEqual = (
  actual: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
  expected: ReadonlyArray<LiveStoreEvent.Client.EncodedWithMeta>,
) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((event, i) => {
    expect(event.seqNum).toStrictEqual(expected[i]!.seqNum)
    expect(event.parentSeqNum).toStrictEqual(expected[i]!.parentSeqNum)
    expect(event.name).toStrictEqual(expected[i]!.name)
    expect(event.args).toStrictEqual(expected[i]!.args)
  })
}

const expectAdvance: (result: typeof SyncState.MergeResult.Type) => asserts result is SyncState.MergeResultAdvance = (
  result,
) => {
  expect(result._tag).toBe('advance')
}

const expectRebase: (result: typeof SyncState.MergeResult.Type) => asserts result is SyncState.MergeResultRebase = (
  result,
) => {
  expect(result._tag, `Expected rebase, got ${result._tag}`).toBe('rebase')
}

const expectReject: (result: typeof SyncState.MergeResult.Type) => asserts result is SyncState.MergeResultReject = (
  result,
) => {
  expect(result._tag).toBe('reject')
}
