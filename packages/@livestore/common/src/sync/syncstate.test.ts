/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { describe, expect, it } from 'vitest'

import type { EventId } from '../adapter-types.js'
import { ROOT_ID } from '../adapter-types.js'
import * as SyncState from './syncstate.js'
import { MutationEventEncodedWithDeferred } from './syncstate.js'

class TestEvent extends MutationEventEncodedWithDeferred {
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

const e_0_0 = new TestEvent({ global: 0, local: 0 }, ROOT_ID, 'a', false)
const e_0_1 = new TestEvent({ global: 0, local: 1 }, e_0_0.id, 'a', true)
const e_0_2 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, 'a', true)
const e_0_3 = new TestEvent({ global: 0, local: 3 }, e_0_2.id, 'a', true)
const e_1_0 = new TestEvent({ global: 1, local: 0 }, e_0_0.id, 'a', false)
const e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, 'a', true)

const isEqualEvent = (a: MutationEventEncodedWithDeferred, b: MutationEventEncodedWithDeferred) =>
  a.id.global === b.id.global && a.id.local === b.id.local && a.args === b.args

const isLocalEvent = (event: MutationEventEncodedWithDeferred) => (event as TestEvent).isLocal

describe('syncstate', () => {
  describe('updateSyncState', () => {
    const run = ({ syncState, update }: { syncState: SyncState.SyncState; update: typeof SyncState.Payload.Type }) =>
      SyncState.updateSyncState({
        syncState,
        payload: update,
        isLocalEvent,
        isEqualEvent,
      })

    describe('upstream-rebase', () => {
      it('should rollback until start', () => {
        const syncState = { pending: [e_1_0], rollbackTail: [e_0_0, e_0_1], upstreamHead: ROOT_ID, localHead: e_1_0.id }
        const e_0_0_e_1_0 = e_0_0.rebase_(e_1_0.id)
        const e_0_1_e_1_1 = e_0_1.rebase_(e_0_0_e_1_0.id)
        const result = run({
          syncState,
          update: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [e_0_0_e_1_0, e_0_1_e_1_1] },
        })
        const e_1_0_e_2_0 = e_1_0.rebase_(e_0_0_e_1_0.id)
        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [])
        expect(result.syncState.upstreamHead).toBe(e_0_1_e_1_1.id)
        expect(result.syncState.localHead).toMatchObject(e_1_0_e_2_0.id)
        expectEventArraysEqual(result.newEvents, [e_0_0_e_1_0, e_0_1_e_1_1])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0])
      })

      it('should rollback only to specified point', () => {
        const syncState = { pending: [e_1_0], rollbackTail: [e_0_0, e_0_1], upstreamHead: ROOT_ID, localHead: e_1_0.id }
        const e_0_1_e_1_0 = e_0_1.rebase_(e_0_0.id)
        const result = run({
          syncState,
          update: { _tag: 'upstream-rebase', rollbackUntil: e_0_1.id, newEvents: [e_0_1_e_1_0] },
        })
        const e_1_0_e_2_0 = e_1_0.rebase_(e_0_1_e_1_0.id)
        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [])
        expect(result.syncState.upstreamHead).toBe(e_0_1_e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_1_0_e_2_0.id)
        expectEventArraysEqual(result.newEvents, [e_0_1_e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_1, e_1_0])
      })
    })

    describe('advance', () => {
      it('should acknowledge pending event when receiving matching event', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_0])
        expect(result.syncState.upstreamHead).toBe(e_0_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0.id)
        expect(result.newEvents).toEqual([])
      })

      it('should acknowledge pending event and add new event', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_1] } })

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
          update: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0, e_1_1] },
        })

        expectAdvance(result)
        expectEventArraysEqual(result.syncState.pending, [])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0, e_1_1])
        expect(result.syncState.upstreamHead).toBe(e_1_1.id)
        expect(result.syncState.localHead).toMatchObject(e_1_1.id)
        expect(result.newEvents).toEqual([e_0_2, e_0_3, e_1_0, e_1_1])
      })
    })

    describe('rebase', () => {
      it('should rebase single local event to end', () => {
        const syncState = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_1] } })

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
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

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
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_1_0] } })
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
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] } })

        const e_0_0_e_2_0 = e_0_0.rebase_(e_1_0.id)

        expectRebase(result)
        expectEventArraysEqual(result.syncState.pending, [e_0_0_e_2_0])
        expectEventArraysEqual(result.syncState.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expect(result.syncState.upstreamHead).toBe(e_1_0.id)
        expect(result.syncState.localHead).toMatchObject(e_0_0_e_2_0.id)
      })

      it('should only rebase divergent events when first event matches', () => {
        const syncState = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID, localHead: e_0_0.id }
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_2, e_0_3, e_1_0] } })

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
        const result = run({ syncState, update: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] } })

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
            const result = run({ syncState, update: { _tag: 'local-push', newEvents: [e_0_1, e_0_2, e_0_3] } })

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
            const result = run({ syncState, update: { _tag: 'local-push', newEvents: [e_0_1, e_0_2] } })

            expectReject(result)
            expect(result.expectedMinimumId).toMatchObject(e_0_2.id)
          })
        })
      })
    })

    it('trim-rollback-tail', () => {
      const syncState = {
        pending: [e_1_0],
        rollbackTail: [e_0_0, e_0_1, e_0_2, e_0_3],
        upstreamHead: e_0_1.id,
        localHead: e_1_0.id,
      }
      const result = run({ syncState, update: { _tag: 'upstream-trim-rollback-tail', newRollbackStart: e_0_2.id } })
      expectAdvance(result)
      expectEventArraysEqual(result.syncState.pending, [e_1_0])
      expectEventArraysEqual(result.syncState.rollbackTail, [e_0_2, e_0_3])
      expect(result.syncState.upstreamHead).toBe(e_0_1.id)
      expect(result.syncState.localHead).toMatchObject(e_1_0.id)
    })
  })
})

const expectEventArraysEqual = (
  actual: ReadonlyArray<MutationEventEncodedWithDeferred>,
  expected: ReadonlyArray<MutationEventEncodedWithDeferred>,
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
