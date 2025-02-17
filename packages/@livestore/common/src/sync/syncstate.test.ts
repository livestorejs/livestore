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
      meta: {},
      clientId: 'static-client-id',
      sessionId: undefined,
    })
  }

  rebase_ = (parentId: EventId.EventId) => {
    return this.rebase(parentId, this.isLocal)
  }

  // Only used for Vitest printing
  // toJSON = () => `(${this.id.global},${this.id.local},${this.payload})`
  // toString = () => this.toJSON()
}

const e_r_1 = new TestEvent({ global: -1, local: 1 }, EventId.ROOT, 'a', true)
const e_0_0 = new TestEvent({ global: 0, local: 0 }, EventId.ROOT, 'a', false)
const e_0_1 = new TestEvent({ global: 0, local: 1 }, e_0_0.id, 'a', true)
const e_0_2 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, 'a', true)
const e_0_3 = new TestEvent({ global: 0, local: 3 }, e_0_2.id, 'a', true)
const e_1_0 = new TestEvent({ global: 1, local: 0 }, e_0_0.id, 'a', false)
const e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, 'a', true)

const isEqualEvent = MutationEvent.isEqualEncoded

const isLocalEvent = (event: MutationEvent.EncodedWithMeta) => (event as TestEvent).isLocal

describe('syncstate', () => {
  describe('updateSyncState', () => {
    const run = ({
      syncState,
      payload,
      ignoreLocalEvents = false,
    }: {
      syncState: SyncState.SyncState
      payload: typeof SyncState.Payload.Type
      ignoreLocalEvents?: boolean
    }) => SyncState.updateSyncState({ syncState, payload, isLocalEvent, isEqualEvent, ignoreLocalEvents })

    describe.each([{ trimRollbackUntil: false }, { trimRollbackUntil: true }])(
      'upstream-rebase (trimRollbackUntil: $trimRollbackUntil)',
      ({ trimRollbackUntil }) => {
        it('should rollback until start', () => {
          const syncState = new SyncState.SyncState({
            pending: [e_1_0],
            rollbackTail: [e_0_0, e_0_1],
            upstreamHead: EventId.ROOT,
            localHead: e_1_0.id,
          })
          const e_0_0_e_1_0 = e_0_0.rebase_(e_1_0.id)
          const e_0_1_e_1_1 = e_0_1.rebase_(e_0_0_e_1_0.id)
          const result = run({
            syncState,
            payload: {
              _tag: 'upstream-rebase',
              rollbackUntil: e_0_0.id,
              newEvents: [e_0_0_e_1_0, e_0_1_e_1_1],
              trimRollbackUntil: trimRollbackUntil ? e_0_1_e_1_1.id : undefined,
            },
          })
          const e_1_0_e_2_0 = e_1_0.rebase_(e_0_0_e_1_0.id)
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e_1_0_e_2_0])
          if (trimRollbackUntil) {
            expectEventArraysEqual(result.newSyncState.rollbackTail, [])
          } else {
            expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0_e_1_0, e_0_1_e_1_1])
          }
          expect(result.newSyncState.upstreamHead).toMatchObject(e_0_1_e_1_1.id)
          expect(result.newSyncState.localHead).toMatchObject(e_1_0_e_2_0.id)
          expectEventArraysEqual(result.newEvents, [e_0_0_e_1_0, e_0_1_e_1_1])
          expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0])
        })

        it('should rollback only to specified point', () => {
          const syncState = new SyncState.SyncState({
            pending: [e_1_0],
            rollbackTail: [e_0_0, e_0_1],
            upstreamHead: EventId.ROOT,
            localHead: e_1_0.id,
          })
          const e_0_1_e_1_0 = e_0_1.rebase_(e_0_0.id)
          const result = run({
            syncState,
            payload: {
              _tag: 'upstream-rebase',
              rollbackUntil: e_0_1.id,
              newEvents: [e_0_1_e_1_0],
              trimRollbackUntil: trimRollbackUntil ? e_0_0.id : undefined,
            },
          })
          const e_1_0_e_2_0 = e_1_0.rebase_(e_0_1_e_1_0.id)
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [e_1_0_e_2_0])
          if (trimRollbackUntil) {
            expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_1_e_1_0])
          } else {
            expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0, e_0_1_e_1_0])
          }
          expect(result.newSyncState.upstreamHead).toMatchObject(e_0_1_e_1_0.id)
          expect(result.newSyncState.localHead).toMatchObject(e_1_0_e_2_0.id)
          expectEventArraysEqual(result.newEvents, [e_0_1_e_1_0])
          expectEventArraysEqual(result.eventsToRollback, [e_0_1, e_1_0])
        })

        it('should work for empty pending', () => {
          const syncState = new SyncState.SyncState({
            pending: [],
            rollbackTail: [e_0_0],
            upstreamHead: EventId.ROOT,
            localHead: e_0_0.id,
          })
          const result = run({
            syncState,
            payload: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [e_1_0] },
          })
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expectEventArraysEqual(result.newSyncState.rollbackTail, [e_1_0])
          expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
          expect(result.newSyncState.localHead).toMatchObject(e_1_0.id)
          expect(result.newEvents).toStrictEqual([e_1_0])
        })

        it('should fail for empty rollback tail', () => {
          const syncState = new SyncState.SyncState({
            pending: [],
            rollbackTail: [],
            upstreamHead: EventId.ROOT,
            localHead: e_0_0.id,
          })
          expect(() =>
            run({
              syncState,
              payload: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [e_1_0] },
            }),
          ).toThrow()
        })

        it('should work for empty incoming', () => {
          const syncState = new SyncState.SyncState({
            pending: [],
            rollbackTail: [e_0_0],
            upstreamHead: EventId.ROOT,
            localHead: e_0_0.id,
          })
          const result = run({
            syncState,
            payload: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [] },
          })
          expectRebase(result)
          expectEventArraysEqual(result.newSyncState.pending, [])
          expectEventArraysEqual(result.newSyncState.rollbackTail, [])
          expect(result.newSyncState.upstreamHead).toMatchObject(EventId.ROOT)
          expect(result.newSyncState.localHead).toMatchObject(EventId.ROOT)
          expect(result.newEvents).toStrictEqual([])
        })
      },
    )

    describe('upstream-advance: advance', () => {
      it('should throw error if newEvents are not sorted in ascending order by eventId (local)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        expect(() => run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_0] } })).toThrow()
      })

      it('should throw error if newEvents are not sorted in ascending order by eventId (global)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        expect(() => run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0, e_0_0] } })).toThrow()
      })

      it('should acknowledge pending event when receiving matching event', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_0.id)
        expect(result.newEvents).toStrictEqual([])
      })

      it('should acknowledge partial pending event when receiving matching event', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0, e_1_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0.id,
        })
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_0])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0.id)
        expect(result.newEvents).toStrictEqual([])
      })

      it('should acknowledge pending event and add new event', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_1] } })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0, e_0_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_1.id)
        expect(result.newEvents).toStrictEqual([e_0_1])
      })

      it('should acknowledge pending event and add multiple new events', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_1],
          rollbackTail: [],
          upstreamHead: e_0_0.id,
          localHead: e_0_1.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0, e_1_1] },
        })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0, e_1_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_1.id)
        expect(result.newEvents).toStrictEqual([e_0_2, e_0_3, e_1_0, e_1_1])
      })

      it('should ignore local events (incoming is subset of pending)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_r_1, e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0] },
          ignoreLocalEvents: true,
        })
        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_r_1, e_0_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_0.id)
        expect(result.newEvents).toStrictEqual([])
      })

      it('should ignore local events (incoming is subset of pending case 2)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_r_1, e_0_0, e_1_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0] },
          ignoreLocalEvents: true,
        })
        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_0])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_r_1, e_0_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0.id)
        expect(result.newEvents).toStrictEqual([])
      })

      it('should ignore local events (incoming goes beyond pending)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_r_1, e_0_0, e_0_1],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_1.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0, e_1_0] },
          ignoreLocalEvents: true,
        })

        expectAdvance(result)
        expectEventArraysEqual(result.newSyncState.pending, [])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_r_1, e_0_0, e_0_1, e_1_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0.id)
        expect(result.newEvents).toStrictEqual([e_1_0])
      })
    })

    describe('upstream-advance: rebase', () => {
      it('should rebase single local event to end', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_1] } })

        const e_0_0_e_0_2 = e_0_0.rebase_(e_0_1.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_0_0_e_0_2])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_1.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_0_e_0_2.id)
        expectEventArraysEqual(result.eventsToRollback, [e_0_0])
        expectEventArraysEqual(result.newEvents, [e_0_1, e_0_0_e_0_2])
      })

      it('should rebase different event with same id (no rollback tail)', () => {
        const e_0_0_b = new TestEvent({ global: 0, local: 0 }, EventId.ROOT, '0_0_b', true)
        const syncState = new SyncState.SyncState({
          pending: [e_0_0_b],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0_b.id,
        })
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        const e_0_0_e_1_0 = e_0_0_b.rebase_(e_0_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_0_0_e_1_0])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0])
        expectEventArraysEqual(result.newEvents, [e_0_0, e_0_0_e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0_b])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_0_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_0_e_1_0.id)
      })

      it('should rebase different event with same id', () => {
        const e_1_0_b = new TestEvent({ global: 1, local: 0 }, e_0_0.id, '1_0_b', false)
        const syncState = new SyncState.SyncState({
          pending: [e_1_0_b],
          rollbackTail: [e_0_0, e_0_1],
          upstreamHead: EventId.ROOT,
          localHead: e_1_0_b.id,
        })
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0] } })
        const e_1_0_e_2_0 = e_1_0_b.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0, e_0_1, e_1_0])
        expectEventArraysEqual(result.newEvents, [e_1_0, e_1_0_e_2_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0_b])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_1_0_e_2_0.id)
      })

      it('should rebase single local event to end (more incoming events)', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] },
        })

        const e_0_0_e_2_0 = e_0_0.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_0_0_e_2_0])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_0_e_2_0.id)
      })

      it('should only rebase divergent events when first event matches', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0, e_0_1],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_0.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_2, e_0_3, e_1_0] },
        })

        const e_0_1_e_1_1 = e_0_1.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_0_1_e_1_1])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_0, e_0_2, e_0_3, e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_1])
        expectEventArraysEqual(result.newEvents, [e_0_2, e_0_3, e_1_0, e_0_1_e_1_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_1_e_1_1.id)
      })

      it('should rebase all local events when incoming chain starts differently', () => {
        const syncState = new SyncState.SyncState({
          pending: [e_0_0, e_0_1],
          rollbackTail: [],
          upstreamHead: EventId.ROOT,
          localHead: e_0_1.id,
        })
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] },
        })

        const e_0_0_e_1_1 = e_0_0.rebase_(e_1_0.id)
        const e_0_1_e_1_2 = e_0_1.rebase_(e_0_0_e_1_1.id)

        expectRebase(result)
        expectEventArraysEqual(result.newSyncState.pending, [e_0_0_e_1_1, e_0_1_e_1_2])
        expectEventArraysEqual(result.newSyncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expectEventArraysEqual(result.newEvents, [e_0_1, e_0_2, e_0_3, e_1_0, e_0_0_e_1_1, e_0_1_e_1_2])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1])
        expect(result.newSyncState.upstreamHead).toMatchObject(e_1_0.id)
        expect(result.newSyncState.localHead).toMatchObject(e_0_1_e_1_2.id)
      })

      describe('local-push', () => {
        describe('advance', () => {
          it('should advance with new events', () => {
            const syncState = new SyncState.SyncState({
              pending: [e_0_0],
              rollbackTail: [],
              upstreamHead: EventId.ROOT,
              localHead: e_0_0.id,
            })
            const result = run({ syncState, payload: { _tag: 'local-push', newEvents: [e_0_1, e_0_2, e_0_3] } })

            expectAdvance(result)
            expectEventArraysEqual(result.newSyncState.pending, [e_0_0, e_0_1, e_0_2, e_0_3])
            expectEventArraysEqual(result.newSyncState.rollbackTail, [])
            expect(result.newSyncState.upstreamHead).toMatchObject(EventId.ROOT)
            expect(result.newSyncState.localHead).toMatchObject(e_0_3.id)
            expectEventArraysEqual(result.newEvents, [e_0_1, e_0_2, e_0_3])
          })
        })

        describe('reject', () => {
          it('should reject when new events are greater than pending events', () => {
            const syncState = new SyncState.SyncState({
              pending: [e_0_0, e_0_1],
              rollbackTail: [],
              upstreamHead: EventId.ROOT,
              localHead: e_0_1.id,
            })
            const result = run({ syncState, payload: { _tag: 'local-push', newEvents: [e_0_1, e_0_2] } })

            expectReject(result)
            expect(result.expectedMinimumId).toMatchObject(e_0_2.id)
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

function expectAdvance(result: SyncState.UpdateResult): asserts result is SyncState.UpdateResultAdvance {
  expect(result._tag).toBe('advance')
}

function expectRebase(result: SyncState.UpdateResult): asserts result is SyncState.UpdateResultRebase {
  expect(result._tag).toBe('rebase')
}

function expectReject(result: SyncState.UpdateResult): asserts result is SyncState.UpdateResultReject {
  expect(result._tag).toBe('reject')
}
