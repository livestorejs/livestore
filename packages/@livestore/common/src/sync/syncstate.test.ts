/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { describe, expect, it } from 'vitest'

import * as EventId from '../schema/EventId.js'
import * as MutationEvent from '../schema/MutationEvent.js'
import * as SyncState from './syncstate.js'

class TestEvent extends MutationEvent.EncodedWithMeta {
  constructor(
    id: EventId.EventId | typeof EventId.EventId.Encoded,
    parentId: EventId.EventId,
    public readonly payload: string,
    public readonly isLocal: boolean,
  ) {
    super({
      id: EventId.make(id),
      parentId: EventId.make(parentId),
      mutation: 'a',
      args: payload,
      clientId: 'static-local-id',
      sessionId: 'static-session-id',
    })
  }

  rebase_ = (parentId: EventId.EventId) => {
    return this.rebase(parentId, this.isLocal)
  }

  // Only used for Vitest printing
  // toJSON = () => `(${this.id.global},${this.id.client},${this.payload})`
  // toString = () => this.toJSON()
}

const e_0_1 = new TestEvent({ global: 0, client: 1 }, EventId.ROOT, 'a', true)
const e_1_0 = new TestEvent({ global: 1, client: 0 }, EventId.ROOT, 'a', false)
const e_1_1 = new TestEvent({ global: 1, client: 1 }, e_1_0.id, 'a', true)
const e_1_2 = new TestEvent({ global: 1, client: 2 }, e_1_1.id, 'a', true)
const e_1_3 = new TestEvent({ global: 1, client: 3 }, e_1_2.id, 'a', true)
const e_2_0 = new TestEvent({ global: 2, client: 0 }, e_1_0.id, 'a', false)
const e_2_1 = new TestEvent({ global: 2, client: 1 }, e_2_0.id, 'a', true)
const e_3_0 = new TestEvent({ global: 3, client: 0 }, e_2_0.id, 'a', false)

const isEqualEvent = MutationEvent.isEqualEncoded

const isClientEvent = (event: MutationEvent.EncodedWithMeta) => (event as TestEvent).isLocal

describe('syncstate', () => {
  describe('merge', () => {
    const merge = ({
      syncState,
      payload,
      ignoreClientEvents = false,
    }: {
      syncState: SyncState.SyncState
      payload: typeof SyncState.Payload.Type
      ignoreClientEvents?: boolean
    }) => SyncState.merge({ syncState, payload, isClientEvent, isEqualEvent, ignoreClientEvents })

    describe('upstream-rebase', () => {
      it('should rollback until start', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_2_0],
          upstreamHead: EventId.ROOT,
          localHead: e_2_0.id,
        })
        const e_1_0_e_2_0 = e_1_0.rebase_(e_2_0.id)
        const e_1_1_e_2_1 = e_1_1.rebase_(e_1_0_e_2_0.id)
        const result = merge({
          syncState,
          payload: SyncState.PayloadUpstreamRebase.make({
            rollbackEvents: [e_1_0, e_1_1],
            newEvents: [e_1_0_e_2_0, e_1_1_e_2_1],
          }),
        })
        const e_2_0_e_3_0 = e_2_0.rebase_(e_1_0_e_2_0.id)
        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_2_0_e_3_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_1_e_2_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0_e_3_0.id)
        expectEventArraysEqual(result.newEvents, [e_1_0_e_2_0, e_1_1_e_2_1, e_2_0_e_3_0])
        expectEventArraysEqual(result.rollbackEvents, [e_1_0, e_1_1, e_2_0])
      })

      it('should rollback only to specified point', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_2_0],
          upstreamHead: EventId.ROOT,
          localHead: e_2_0.id,
        })
        const e_1_1_e_2_0 = e_1_1.rebase_(e_1_0.id)
        const result = merge({
          syncState,
          payload: SyncState.PayloadUpstreamRebase.make({
            newEvents: [e_1_1_e_2_0],
            rollbackEvents: [e_1_1],
          }),
        })
        const e_2_0_e_3_0 = e_2_0.rebase_(e_1_1_e_2_0.id)
        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_2_0_e_3_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_1_e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0_e_3_0.id)
        expectEventArraysEqual(result.newEvents, [e_1_1_e_2_0, e_2_0_e_3_0])
        expectEventArraysEqual(result.rollbackEvents, [e_1_1, e_2_0])
      })

      it('should work for empty pending', () => {
        const syncState = new SyncState.SyncState({
          pending: [],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({
          syncState,
          payload: SyncState.PayloadUpstreamRebase.make({ rollbackEvents: [e_1_0], newEvents: [e_2_0] }),
        })
        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0.id)
        expect(result.newEvents).toStrictEqual([e_2_0])
      })
    })

    describe('upstream-advance: advance', () => {
      it('should throw error if newEvents are not sorted in ascending order by eventId (client)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_1, e_1_0] } })
        expect(result).toMatchObject({ _tag: 'unexpected-error' })
      })

      it('should throw error if newEvents are not sorted in ascending order by eventId (global)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_2_0, e_1_0] } })
        expect(result).toMatchObject({ _tag: 'unexpected-error' })
      })

      it('should throw error if incoming event is < expected upstream head', () => {
        const syncState = new SyncState.SyncState({
          pending: [],
          upstreamHead: e_2_0.id,
          localHead: e_2_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0] } })
        expect(result).toMatchObject({ _tag: 'unexpected-error' })
      })

      it('should throw error if incoming event is = expected upstream head', () => {
        const syncState = new SyncState.SyncState({
          pending: [],
          upstreamHead: e_2_0.id,
          localHead: e_2_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_2_0] } })
        expect(result).toMatchObject({ _tag: 'unexpected-error' })
      })

      it('should throw if the parent id of the first incoming event is unknown', () => {
        const syncState = new SyncState.SyncState({
          pending: [],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_3_0] } })
        expect(result).toMatchObject({ _tag: 'unexpected-error' })
      })

      it('should confirm pending event when receiving matching event', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0.id)
        expectEventArraysEqual(result.newEvents, [])
        expectEventArraysEqual(result.confirmedEvents, [e_1_0])
      })

      it('should confirm partial pending event when receiving matching event', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0, e_2_0],
          upstreamHead: EventId.ROOT,
          localHead: e_2_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_2_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0.id)
        expectEventArraysEqual(result.newEvents, [])
        expectEventArraysEqual(result.confirmedEvents, [e_1_0])
      })

      it('should confirm pending event and add new event', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0, e_1_1] } })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_1.id)
        expect(result.newEvents).toStrictEqual([e_1_1])
        expectEventArraysEqual(result.confirmedEvents, [e_1_0])
      })

      it('should confirm pending event and add multiple new events', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_1],
          upstreamHead: e_1_0.id,
          localHead: e_1_1.id,
        })
        const result = merge({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_1_1, e_1_2, e_1_3, e_2_0, e_2_1] },
        })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_1.id)
        expect(result.newEvents).toStrictEqual([e_1_2, e_1_3, e_2_0, e_2_1])
        expectEventArraysEqual(result.confirmedEvents, [e_1_1])
      })

      it('should confirm pending global event while keep pending client events', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0, e_1_1],
          upstreamHead: EventId.ROOT,
          localHead: e_1_1.id,
        })
        const result = merge({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_1_0] },
        })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_1.id)
        expectEventArraysEqual(result.newEvents, [])
        expectEventArraysEqual(result.confirmedEvents, [e_1_0])
      })

      it('should ignore client events (incoming is subset of pending)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_1, e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_1_0] },
          ignoreClientEvents: true,
        })
        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0.id)
        expectEventArraysEqual(result.newEvents, [])
        expectEventArraysEqual(result.confirmedEvents, [e_0_1, e_1_0])
      })

      it('should ignore client events (incoming is subset of pending case 2)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_1, e_1_0, e_2_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_1_0] },
          ignoreClientEvents: true,
        })
        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_2_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0.id)
        expectEventArraysEqual(result.newEvents, [])
        expectEventArraysEqual(result.confirmedEvents, [e_0_1, e_1_0])
      })

      it('should ignore client events (incoming goes beyond pending)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_1, e_1_0, e_1_1],
          upstreamHead: EventId.ROOT,
          localHead: e_1_1.id,
        })
        const result = merge({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_1_0, e_2_0] },
          ignoreClientEvents: true,
        })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0.id)
        expect(result.newEvents).toStrictEqual([e_2_0])
        expectEventArraysEqual(result.confirmedEvents, [e_0_1, e_1_0, e_1_1])
      })

      it('should fail if incoming event is ≤ local head', () => {
        const syncState = new SyncState.SyncState({
          pending: [],
          upstreamHead: e_2_0.id,
          localHead: e_2_0.id,
        })
        const result = merge({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0] } })
        expect(result).toMatchObject({ _tag: 'unexpected-error' })
      })
    })

    describe('upstream-advance: rebase', () => {
      it('should rebase single client event to end', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({ syncState, payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e_1_1] }) })

        const e_1_0_e_1_2 = e_1_0.rebase_(e_1_1.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_0_e_1_2])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0_e_1_2.id)
        expectEventArraysEqual(result.rollbackEvents, [e_1_0])
        expectEventArraysEqual(result.newEvents, [e_1_1, e_1_0_e_1_2])
      })

      it('should rebase different event with same id', () => {
        const e_2_0_b = new TestEvent({ global: 1, client: 0 }, e_1_0.id, '1_0_b', false)
        const syncState = new SyncState.SyncState({
          pending: [e_2_0_b],
          upstreamHead: EventId.ROOT,
          localHead: e_2_0_b.id,
        })
        const result = merge({ syncState, payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e_2_0] }) })
        const e_2_0_e_3_0 = e_2_0_b.rebase_(e_2_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_2_0_e_3_0])
        expectEventArraysEqual(result.newEvents, [e_2_0, e_2_0_e_3_0])
        expectEventArraysEqual(result.rollbackEvents, [e_2_0_b])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_2_0_e_3_0.id)
      })

      it('should rebase single client event to end (more incoming events)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({
          syncState,
          payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e_1_1, e_1_2, e_1_3, e_2_0] }),
        })

        const e_1_0_e_3_0 = e_1_0.rebase_(e_2_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_0_e_3_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0_e_3_0.id)
      })

      it('should only rebase divergent events when first event matches', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0, e_1_1],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = merge({
          syncState,
          payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e_1_0, e_1_2, e_1_3, e_2_0] }),
        })

        const e_1_1_e_2_1 = e_1_1.rebase_(e_2_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_1_e_2_1])
        expectEventArraysEqual(result.rollbackEvents, [e_1_1])
        expectEventArraysEqual(result.newEvents, [e_1_2, e_1_3, e_2_0, e_1_1_e_2_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_1_e_2_1.id)
      })

      it('should rebase all client events when incoming chain starts differently', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_1_0, e_1_1],
          upstreamHead: EventId.ROOT,
          localHead: e_1_1.id,
        })
        const result = merge({
          syncState,
          payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: [e_1_1, e_1_2, e_1_3, e_2_0] }),
        })

        const e_1_0_e_2_1 = e_1_0.rebase_(e_2_0.id)
        const e_1_1_e_2_2 = e_1_1.rebase_(e_1_0_e_2_1.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_0_e_2_1, e_1_1_e_2_2])
        expectEventArraysEqual(result.newEvents, [e_1_1, e_1_2, e_1_3, e_2_0, e_1_0_e_2_1, e_1_1_e_2_2])
        expectEventArraysEqual(result.rollbackEvents, [e_1_0, e_1_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_2_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_1_e_2_2.id)
      })

      describe('local-push', () => {
        describe('advance', () => {
          it('should advance with new events', () => {
            const syncState = new SyncState.SyncState({
              pending: [e_1_0],
              upstreamHead: EventId.ROOT,
              localHead: e_1_0.id,
            })
            const result = merge({
              syncState,
              payload: SyncState.PayloadLocalPush.make({ newEvents: [e_1_1, e_1_2, e_1_3] }),
            })

            expectAdvance(result)
            expectEventArraysEqual(result.newSyncState.pending, [e_1_0, e_1_1, e_1_2, e_1_3])
            expect(result.newSyncState.upstreamHead).toMatchObject(EventId.ROOT)
            expect(result.newSyncState.localHead).toMatchObject(e_1_3.id)
            expectEventArraysEqual(result.newEvents, [e_1_1, e_1_2, e_1_3])
            expectEventArraysEqual(result.confirmedEvents, [])
          })
        })

        describe('reject', () => {
          it('should reject when new events are greater than pending events', () => {
            const syncState = new SyncState.SyncState({
              pending: [e_1_0, e_1_1],
              upstreamHead: EventId.ROOT,
              localHead: e_1_1.id,
            })
            const result = merge({
              syncState,
              payload: SyncState.PayloadLocalPush.make({ newEvents: [e_1_1, e_1_2] }),
            })

            expectReject(result)
            expect(result.expectedMinimumId).toMatchObject(e_1_2.id)
          })
        })
      })
    })
  })
})

const expectEventArraysEqual = (
  actual: ReadonlyArray<MutationEvent.EncodedWithMeta>,
  expected: ReadonlyArray<MutationEvent.EncodedWithMeta>,
) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((event, i) => {
    expect(event.id).toStrictEqual(expected[i]!.id)
    expect(event.parentId).toStrictEqual(expected[i]!.parentId)
    expect(event.mutation).toStrictEqual(expected[i]!.mutation)
    expect(event.args).toStrictEqual(expected[i]!.args)
  })
}

function expectAdvance(
  result: typeof SyncState.MergeResult.Type,
): asserts result is typeof SyncState.MergeResultAdvance.Type {
  expect(result._tag).toBe('advance')
}

function expectRebase(
  result: typeof SyncState.MergeResult.Type,
): asserts result is typeof SyncState.MergeResultRebase.Type {
  expect(result._tag, `Expected rebase, got ${result}`).toBe('rebase')
}

function expectReject(
  result: typeof SyncState.MergeResult.Type,
): asserts result is typeof SyncState.MergeResultReject.Type {
  expect(result._tag).toBe('reject')
}
