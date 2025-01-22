/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { describe, expect, it } from 'vitest'

import type { EventId } from '../adapter-types.js'
import { ROOT_ID } from '../adapter-types.js'
import { MutationEventEncodedWithMeta } from '../schema/MutationEvent.js'
import * as SyncState from './syncstate.js'

class TestEvent extends MutationEventEncodedWithMeta {
  constructor(
    public readonly id: EventId,
    public readonly parentId: EventId,
    public readonly payload: string,
    public readonly isLocal: boolean,
  ) {
    super({
      id,
      parentId,
      mutation: 'a',
      args: payload,
      meta: {},
    })
  }

  rebase_ = (parentId: EventId) => {
    return this.rebase(parentId, this.isLocal)
  }

  // Only used for Vitest printing
  // toJSON = () => `(${this.id.global},${this.id.local},${this.payload})`
  // toString = () => this.toJSON()
}

const e_r_1 = new TestEvent({ global: -1, local: 1 }, ROOT_ID, 'a', true)
const e_0_0 = new TestEvent({ global: 0, local: 0 }, ROOT_ID, 'a', false)
const e_0_1 = new TestEvent({ global: 0, local: 1 }, e_0_0.id, 'a', true)
const e_0_2 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, 'a', true)
const e_0_3 = new TestEvent({ global: 0, local: 3 }, e_0_2.id, 'a', true)
const e_1_0 = new TestEvent({ global: 1, local: 0 }, e_0_0.id, 'a', false)
const e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, 'a', true)

const isEqualEvent = (a: MutationEventEncodedWithMeta, b: MutationEventEncodedWithMeta) =>
  a.id.global === b.id.global && a.id.local === b.id.local && a.args === b.args

const isLocalEvent = (event: MutationEventEncodedWithMeta) => (event as TestEvent).isLocal

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
          const syncState = {
            pending: [e_1_0],
            rollbackTail: [e_0_0, e_0_1],
            upstreamHead: ROOT_ID,
            localHead: e_1_0.id,
          }
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
          expectEventArraysEqual(result.syncState.pending, [e_1_0_e_2_0])
          if (trimRollbackUntil) {
            expectEventArraysEqual(result.syncState.rollbackTail, [])
          } else {
            expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0_e_1_0, e_0_1_e_1_1])
          }
          expect(result.syncState.upstreamHead).toBe(e_0_1_e_1_1.id)
          expect(result.syncState.localHead).toMatchObject(e_1_0_e_2_0.id)
          expectEventArraysEqual(result.newEvents, [e_0_0_e_1_0, e_0_1_e_1_1])
          expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0])
        })

        it('should rollback only to specified point', () => {
          const syncState = {
            pending: [e_1_0],
            rollbackTail: [e_0_0, e_0_1],
            upstreamHead: ROOT_ID,
            localHead: e_1_0.id,
          }
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
          expectEventArraysEqual(result.syncState.pending, [e_1_0_e_2_0])
          if (trimRollbackUntil) {
            expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1_e_1_0])
          } else {
            expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0, e_0_1_e_1_0])
          }
          expect(result.syncState.upstreamHead).toBe(e_0_1_e_1_0.id)
          expect(result.syncState.localHead).toMatchObject(e_1_0_e_2_0.id)
          expectEventArraysEqual(result.newEvents, [e_0_1_e_1_0])
          expectEventArraysEqual(result.eventsToRollback, [e_0_1, e_1_0])
        })

        it('should work for empty pending', () => {
          const syncState = { pending: [], rollbackTail: [e_0_0], upstreamHead: ROOT_ID, localHead: e_0_0.id }
          const result = run({
            syncState,
            payload: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [e_1_0] },
          })
          expectRebase(result)
          expectEventArraysEqual(result.syncState.pending, [])
          expectEventArraysEqual(result.syncState.rollbackTail, [e_1_0])
          expect(result.syncState.upstreamHead).toBe(e_1_0.id)
          expect(result.syncState.localHead).toMatchObject(e_1_0.id)
          expect(result.newEvents).toEqual([e_1_0])
        })

        it('should fail for empty rollback tail', () => {
          const syncState = { pending: [], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
          expect(() =>
            run({
              syncState,
              payload: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [e_1_0] },
            }),
          ).toThrow()
        })

        it('should work for empty incoming', () => {
          const syncState = { pending: [], rollbackTail: [e_0_0], upstreamHead: ROOT_ID, localHead: e_0_0.id }
          const result = run({
            syncState,
            payload: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [] },
          })
          expectRebase(result)
          expectEventArraysEqual(result.syncState.pending, [])
          expectEventArraysEqual(result.syncState.rollbackTail, [])
          expect(result.syncState.upstreamHead).toBe(ROOT_ID)
          expect(result.syncState.localHead).toMatchObject(ROOT_ID)
          expect(result.newEvents).toEqual([])
        })
      },
    )

    describe('upstream-advance: advance', () => {
      it('should throw error if newEvents are not sorted in ascending order by eventId (local)', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        expect(() => run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_0] } })).toThrow()
      })

      it('should throw error if newEvents are not sorted in ascending order by eventId (global)', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        expect(() => run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0, e_0_0] } })).toThrow()
      })

      it('should acknowledge pending event when receiving matching event', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0])
        expect(result.syncState.upstreamHead).toBe(e_0_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0.id)
        expect(result.newEvents).toEqual([])
      })

      it('should acknowledge partial pending event when receiving matching event', () => {
        const syncState = { pending: [e_0_0, e_1_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_1_0.id }
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [e_1_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0])
        expect(result.syncState.upstreamHead).toBe(e_0_0.id)
        expect(result.syncState.localHead).toMatchObject(e_1_0.id)
        expect(result.newEvents).toEqual([])
      })

      it('should acknowledge pending event and add new event', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_1] } })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0, e_0_1])
        expect(result.syncState.upstreamHead).toBe(e_0_1.id)
        expect(result.syncState.localHead).toMatchObject(e_0_1.id)
        expect(result.newEvents).toEqual([e_0_1])
      })

      it('should acknowledge pending event and add multiple new events', () => {
        const syncState = { pending: [e_0_1], rollbackTail: [], upstreamHead: e_0_0.id, localHead: e_0_1.id }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0, e_1_1] },
        })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0, e_1_1])
        expect(result.syncState.upstreamHead).toBe(e_1_1.id)
        expect(result.syncState.localHead).toMatchObject(e_1_1.id)
        expect(result.newEvents).toEqual([e_0_2, e_0_3, e_1_0, e_1_1])
      })

      it('should ignore local events (incoming is subset of pending)', () => {
        const syncState = { pending: [e_r_1, e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0] },
          ignoreLocalEvents: true,
        })
        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_r_1, e_0_0])
        expect(result.syncState.upstreamHead).toBe(e_0_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0.id)
        expect(result.newEvents).toEqual([])
      })

      it('should ignore local events (incoming is subset of pending case 2)', () => {
        const syncState = {
          pending: [e_r_1, e_0_0, e_1_0],
          rollbackTail: [],
          upstreamHead: ROOT_ID,
          localHead: e_0_0.id,
        }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0] },
          ignoreLocalEvents: true,
        })
        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [e_1_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_r_1, e_0_0])
        expect(result.syncState.upstreamHead).toBe(e_0_0.id)
        expect(result.syncState.localHead).toMatchObject(e_1_0.id)
        expect(result.newEvents).toEqual([])
      })

      it('should ignore local events (incoming goes beyond pending)', () => {
        const syncState = {
          pending: [e_r_1, e_0_0, e_0_1],
          rollbackTail: [],
          upstreamHead: ROOT_ID,
          localHead: e_0_1.id,
        }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0, e_1_0] },
          ignoreLocalEvents: true,
        })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_r_1, e_0_0, e_0_1, e_1_0])
        expect(result.syncState.upstreamHead).toBe(e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_1_0.id)
        expect(result.newEvents).toEqual([e_1_0])
      })
    })

    describe('upstream-advance: rebase', () => {
      it('should rebase single local event to end', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_1] } })

        const e_0_0_e_0_2 = e_0_0.rebase_(e_0_1.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_0_0_e_0_2])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1])
        expect(result.syncState.upstreamHead).toBe(e_0_1.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0_e_0_2.id)
        expectEventArraysEqual(result.eventsToRollback, [e_0_0])
        expectEventArraysEqual(result.newEvents, [e_0_1, e_0_0_e_0_2])
      })

      it('should rebase different event with same id (no rollback tail)', () => {
        const e_0_0_b = new TestEvent({ global: 0, local: 0 }, ROOT_ID, '0_0_b', true)
        const syncState = { pending: [e_0_0_b], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0_b.id }
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        const e_0_0_e_1_0 = e_0_0_b.rebase_(e_0_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_0_0_e_1_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0])
        expectEventArraysEqual(result.newEvents, [e_0_0, e_0_0_e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0_b])
        expect(result.syncState.upstreamHead).toBe(e_0_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0_e_1_0.id)
      })

      it('should rebase different event with same id', () => {
        const e_1_0_b = new TestEvent({ global: 1, local: 0 }, e_0_0.id, '1_0_b', false)
        const syncState = {
          pending: [e_1_0_b],
          rollbackTail: [e_0_0, e_0_1],
          upstreamHead: ROOT_ID,
          localHead: e_1_0_b.id,
        }
        const result = run({ syncState, payload: { _tag: 'upstream-advance', newEvents: [e_1_0] } })
        const e_1_0_e_2_0 = e_1_0_b.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0, e_0_1, e_1_0])
        expectEventArraysEqual(result.newEvents, [e_1_0, e_1_0_e_2_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0_b])
        expect(result.syncState.upstreamHead).toBe(e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_1_0_e_2_0.id)
      })

      it('should rebase single local event to end (more incoming events)', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] },
        })

        const e_0_0_e_2_0 = e_0_0.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_0_0_e_2_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expect(result.syncState.upstreamHead).toBe(e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0_e_2_0.id)
      })

      it('should only rebase divergent events when first event matches', () => {
        const syncState = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_2, e_0_3, e_1_0] },
        })

        const e_0_1_e_1_1 = e_0_1.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_0_1_e_1_1])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0, e_0_2, e_0_3, e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_1])
        expectEventArraysEqual(result.newEvents, [e_0_2, e_0_3, e_1_0, e_0_1_e_1_1])
        expect(result.syncState.upstreamHead).toBe(e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_1_e_1_1.id)
      })

      it('should rebase all local events when incoming chain starts differently', () => {
        const syncState = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_1.id }
        const result = run({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] },
        })

        const e_0_0_e_1_1 = e_0_0.rebase_(e_1_0.id)
        const e_0_1_e_1_2 = e_0_1.rebase_(e_0_0_e_1_1.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_0_0_e_1_1, e_0_1_e_1_2])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expectEventArraysEqual(result.newEvents, [e_0_1, e_0_2, e_0_3, e_1_0, e_0_0_e_1_1, e_0_1_e_1_2])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1])
        expect(result.syncState.upstreamHead).toBe(e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_1_e_1_2.id)
      })

      describe('local-push', () => {
        describe('advance', () => {
          it('should advance with new events', () => {
            const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
            const result = run({ syncState, payload: { _tag: 'local-push', newEvents: [e_0_1, e_0_2, e_0_3] } })

            expectAdvance(result)
            expectEventArraysEqual(result.syncState.pending, [e_0_0, e_0_1, e_0_2, e_0_3])
            expectEventArraysEqual(result.syncState.rollbackTail, [])
            expect(result.syncState.upstreamHead).toBe(ROOT_ID)
            expect(result.syncState.localHead).toMatchObject(e_0_3.id)
            expectEventArraysEqual(result.newEvents, [e_0_1, e_0_2, e_0_3])
          })
        })

        describe('reject', () => {
          it('should reject when new events are greater than pending events', () => {
            const syncState = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_1.id }
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
  actual: ReadonlyArray<MutationEventEncodedWithMeta>,
  expected: ReadonlyArray<MutationEventEncodedWithMeta>,
) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((event, i) => {
    expect(event.id).toEqual(expected[i]!.id)
    expect(event.parentId).toEqual(expected[i]!.parentId)
    expect(event.mutation).toEqual(expected[i]!.mutation)
    expect(event.args).toEqual(expected[i]!.args)
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
