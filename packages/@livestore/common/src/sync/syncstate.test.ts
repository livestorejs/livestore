import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Cause, Effect, Exit, Schema } from '@livestore/utils/effect'
import { assert, expect } from 'vitest'

import * as EventSequenceNumber from '../schema/EventSequenceNumber/mod.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent/mod.ts'
import * as SyncState from './syncstate.ts'

class TestEvent extends LiveStoreEvent.Client.EncodedWithMeta {
  public payload = 'uninitialized'
  public isClient = false

  static new = (
    seqNum: EventSequenceNumber.Client.CompositeInput,
    parentSeqNum: EventSequenceNumber.Client.CompositeInput,
    payload: string,
    isClient: boolean,
  ) => {
    const event = new TestEvent({
      seqNum: EventSequenceNumber.Client.Composite.make(seqNum),
      parentSeqNum: EventSequenceNumber.Client.Composite.make(parentSeqNum),
      name: 'a',
      args: payload,
      clientId: 'static-local-id',
      sessionId: 'static-session-id',
    })
    event.payload = payload
    event.isClient = isClient
    return event
  }

  rebase_ = (parentSeqNum: EventSequenceNumber.Client.Composite, rebaseGeneration: number) => {
    return this.rebase({ parentSeqNum, isClient: this.isClient, rebaseGeneration })
  }

  // Only used for Vitest printing
  // toJSON = () => `(${this.seqNum.global},${this.seqNum.client},${this.payload})`
  // toString = () => this.toJSON()
}

const e0_1 = TestEvent.new({ global: 0, client: 1 }, EventSequenceNumber.Client.ROOT, 'a', true)
const e1_0 = TestEvent.new({ global: 1, client: 0 }, EventSequenceNumber.Client.ROOT, 'a', false)
const e1_1 = TestEvent.new({ global: 1, client: 1 }, e1_0.seqNum, 'a', true)
const e1_2 = TestEvent.new({ global: 1, client: 2 }, e1_1.seqNum, 'a', true)
const e1_3 = TestEvent.new({ global: 1, client: 3 }, e1_2.seqNum, 'a', true)
const e2_0 = TestEvent.new({ global: 2, client: 0 }, e1_0.seqNum, 'a', false)
const e2_1 = TestEvent.new({ global: 2, client: 1 }, e2_0.seqNum, 'a', true)

const isEqualEvent = LiveStoreEvent.Client.isEqualEncoded

const isClientEvent = (event: LiveStoreEvent.Client.EncodedWithMeta) => (event as TestEvent).isClient

Vitest.describe('syncstate', () => {
  Vitest.describe('merge', () => {
    const merge = ({
      syncState,
      payload,
      ignoreClientEvents = false,
    }: {
      syncState: SyncState.SyncState
      payload: typeof SyncState.Payload.Type
      ignoreClientEvents?: boolean
    }) => SyncState.merge({ syncState, payload, isClientEvent, isEqualEvent, ignoreClientEvents })

    Vitest.describe('upstream-rebase', () => {
      Vitest.it.effect('should rollback until start', () =>
        Effect.gen(function* () {
          const syncState = new SyncState.SyncState({
            pending: [e2_0],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e2_0.seqNum,
          })
          const e1_0_e2_0 = e1_0.rebase_(e2_0.seqNum, 0)
          const e1_1_e2_1 = e1_1.rebase_(e1_0_e2_0.seqNum, 0)
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamRebase.make({
              rollbackEvents: [e1_0, e1_1],
              newEvents: [e1_0_e2_0, e1_1_e2_1],
            }),
          })
          const e2_0_e3_0 = e2_0.rebase_(e1_0_e2_0.seqNum, 1)
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
          const e1_1_e2_0 = e1_1.rebase_(e1_0.seqNum, 0)
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamRebase.make({
              newEvents: [e1_1_e2_0],
              rollbackEvents: [e1_1],
            }),
          })
          const e2_0_e3_0 = e2_0.rebase_(e1_1_e2_0.seqNum, 1)
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
          expect(result.newEvents).toStrictEqual([e2_0])
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
          expect(Cause.isDie(exit.cause)).toBe(true)
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
          expect(Cause.isDie(exit.cause)).toBe(true)
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
          expect(Cause.isDie(exit.cause)).toBe(true)
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
          expect(Cause.isDie(exit.cause)).toBe(true)
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
          expect(result.newEvents).toStrictEqual([e1_1])
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
          expect(result.newEvents).toStrictEqual([e1_2, e1_3, e2_0, e2_1])
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
            ignoreClientEvents: true,
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
            ignoreClientEvents: true,
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
            ignoreClientEvents: true,
          })

          expectAdvance(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(e2_0.seqNum)
          expect(result.newSyncState.localHead).toMatchObject(e2_0.seqNum)
          expect(result.newEvents).toStrictEqual([e2_0])
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
          expect(Cause.isDie(exit.cause)).toBe(true)
        }),
      )

      Vitest.it.effect('should advance (not rebase) when pending event has undefined-valued key dropped by JSON wire round-trip', () =>
        Effect.gen(function* () {
          const argsSchema = Schema.Struct({
            id: Schema.String,
            flag: Schema.UndefinedOr(Schema.Boolean),
          })
          const localArgs = Schema.encodeUnknownSync(argsSchema)({ id: 'abc' } as any)
          const wireArgs = JSON.parse(JSON.stringify(localArgs))

          const localPending = new TestEvent({
            seqNum: e1_0.seqNum,
            parentSeqNum: e1_0.parentSeqNum,
            name: e1_0.name,
            args: localArgs,
            clientId: e1_0.clientId,
            sessionId: e1_0.sessionId,
          })
          const fromUpstream = new TestEvent({
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

          const e1_0_e1_2 = e1_0.rebase_(e1_1.seqNum, 1)

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
          const e2_0_b = TestEvent.new({ global: 1, client: 0 }, e1_0.seqNum, '1_0_b', false)
          const syncState = new SyncState.SyncState({
            pending: [e2_0_b],
            upstreamHead: EventSequenceNumber.Client.ROOT,
            localHead: e2_0_b.seqNum,
          })
          const result = yield* merge({
            syncState,
            payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e2_0] }),
          })
          const e2_0_e3_0 = e2_0_b.rebase_(e2_0.seqNum, 1)

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

          const e1_0_e3_0 = e1_0.rebase_(e2_0.seqNum, 1)

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

          const e1_1_e2_1 = e1_1.rebase_(e2_0.seqNum, 1)

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

          const e1_0_e2_1 = e1_0.rebase_(e2_0.seqNum, 1)
          const e1_1_e2_2 = e1_1.rebase_(e1_0_e2_1.seqNum, 1)

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
                ignoreClientEvents: true,
              })

              expectAdvance(result)
              expectEventArraysEqual(result.newSyncState.pending, [])
              expect(result.newSyncState.upstreamHead).toMatchObject(EventSequenceNumber.Client.ROOT)
              expect(result.newSyncState.localHead).toMatchObject(EventSequenceNumber.Client.ROOT)
              expectEventArraysEqual(result.newEvents, [e0_1])
            }),
          )

          Vitest.it.effect(
            'appends only upstream-bound events to pending when ignoring client-only pushes',
            () =>
              Effect.gen(function* () {
                const syncState = new SyncState.SyncState({
                  pending: [],
                  upstreamHead: EventSequenceNumber.Client.ROOT,
                  localHead: EventSequenceNumber.Client.ROOT,
                })

                const result = yield* merge({
                  syncState,
                  payload: SyncState.PayloadLocalPush.make({ newEvents: [e0_1, e1_0] }),
                  ignoreClientEvents: true,
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

const expectAdvance: (
  result: typeof SyncState.MergeResult.Type,
) => asserts result is typeof SyncState.MergeResultAdvance.Type = (result) => {
  expect(result._tag).toBe('advance')
}

const expectRebase: (
  result: typeof SyncState.MergeResult.Type,
) => asserts result is typeof SyncState.MergeResultRebase.Type = (result) => {
  expect(result._tag, `Expected rebase, got ${result._tag}`).toBe('rebase')
}

const expectReject: (
  result: typeof SyncState.MergeResult.Type,
) => asserts result is typeof SyncState.MergeResultReject.Type = (result) => {
  expect(result._tag).toBe('reject')
}
