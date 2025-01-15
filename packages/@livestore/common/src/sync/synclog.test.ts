/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { describe, expect, it } from 'vitest'

import type { EventId } from '../adapter-types.js'
import { ROOT_ID } from '../adapter-types.js'
import type { MutationEventLike, SyncLog, UpdateResult, UpdateResultAdvance, UpdateResultRebase } from './synclog.js'
import { createNextEventId, SyncLog2, updateSyncLog } from './synclog.js'
import { SyncLogNetwork } from './synclog-node.js'

class TestEvent implements MutationEventLike {
  constructor(
    public readonly id: EventId,
    public readonly parentId: EventId,
    public readonly payload: string,
    public readonly isLocal: boolean,
  ) {}

  rebase_ = (parentId_: EventId) => {
    const parentId = this.isLocal ? parentId_ : { global: parentId_.global, local: 0 }
    return new TestEvent(createNextEventId(parentId, this.isLocal), parentId, this.payload, this.isLocal)
  }

  // Only used for Vitest printing
  toJSON = () => `(${this.id.global},${this.id.local},${this.payload})`
  toString = () => this.toJSON()
}

const e_0_0 = new TestEvent({ global: 0, local: 0 }, ROOT_ID, 'a', false)
const e_0_1 = new TestEvent({ global: 0, local: 1 }, e_0_0.id, 'a', true)
const e_0_2 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, 'a', true)
const e_0_3 = new TestEvent({ global: 0, local: 3 }, e_0_2.id, 'a', true)
const e_1_0 = new TestEvent({ global: 1, local: 0 }, e_0_0.id, 'a', false)
const e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, 'a', true)

const isEqualEvent = (a: TestEvent, b: TestEvent) =>
  a.id.global === b.id.global && a.id.local === b.id.local && a.payload === b.payload

// describe('synclog', () => {
//   describe('leader origin', () => {
//     const run = ({ syncLog, incomingEvents }: { syncLog: SyncLog<TestEvent>; incomingEvents: TestEvent[] }) =>
//       updateSyncLog({ syncLog, incomingEvents, origin: 'leader', isEqualEvent, isLocalEvent: () => true })

//     describe('advance', () => {
//       it('should acknowledge local event when receiving matching leader event', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_0] })

//         expectNoAdvance(result)
//         expect(result.newEvents).toEqual([])
//         expect(result.syncLog).toEqual({ pendingEvents: { local: [], leader: [e_0_0] }, backendHead: ROOT_ID.global })
//       })

//       it('should add new leader event when no local events exist', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_0] })

//         expectNoAdvance(result)
//         expect(result.newEvents).toEqual([e_0_0])
//         expect(result.syncLog).toEqual({ pendingEvents: { leader: [e_0_0], local: [] }, backendHead: ROOT_ID.global })
//       })

//       it('should acknowledge local event and add new leader event', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_0, e_0_1] })

//         expectNoAdvance(result)
//         expect(result.newEvents).toEqual([e_0_1])
//         expect(result.syncLog).toEqual({
//           pendingEvents: { leader: [e_0_0, e_0_1], local: [] },
//           backendHead: ROOT_ID.global,
//         })
//       })

//       it('should acknowledge local event and add multiple new leader events', () => {
//         const syncLog = { pendingEvents: { leader: [e_0_0], local: [e_0_1] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_1, e_0_2, e_0_3, e_1_0] })

//         expectNoAdvance(result)
//         expect(result.newEvents).toEqual([e_0_2, e_0_3, e_1_0])
//         expect(result.syncLog).toEqual({
//           pendingEvents: { leader: [e_0_0, e_0_1, e_0_2, e_0_3, e_1_0], local: [] },
//           backendHead: ROOT_ID.global,
//         })
//       })
//     })

//     describe('rebase', () => {
//       it('should rebase single local event to end', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_1] })

//         const e_0_0_e_0_2 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, '0_0_a', true)

//         expectRebase(result)
//         expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_1])
//         expectEventArraysEqual(result.syncLog.pendingEvents.local, [e_0_0_e_0_2])
//         expectEventArraysEqual(result.eventsToRollback, [e_0_0])
//         expect(result.syncLog.backendHead).toBe(ROOT_ID.global)
//       })

//       it('should rebase single local event to end (more incoming events)', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_1, e_0_2, e_0_3, e_1_0] })

//         const e_0_0_e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, '0_0_a', true)

//         expectRebase(result)
//         expectEventArraysEqual(result.syncLog.pendingEvents.local, [e_0_0_e_1_1])
//         expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_1, e_0_2, e_0_3, e_1_0])
//         expectEventArraysEqual(result.eventsToRollback, [e_0_0])
//         expect(result.syncLog.backendHead).toBe(ROOT_ID.global)
//       })

//       it('should only rebase divergent events when first event matches', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0, e_0_1] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_0, e_0_2, e_0_3, e_1_0] })

//         const e_0_1_e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, '0_1_a', true)

//         expectRebase(result)
//         expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_0, e_0_2, e_0_3, e_1_0])
//         expectEventArraysEqual(result.syncLog.pendingEvents.local, [e_0_1_e_1_1])
//         expectEventArraysEqual(result.eventsToRollback, [e_0_1])
//         expect(result.syncLog.backendHead).toBe(ROOT_ID.global)
//       })

//       it('should rebase all local events when incoming chain starts differently', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0, e_0_1] }, backendHead: ROOT_ID.global }
//         const result = run({ syncLog, incomingEvents: [e_0_1, e_0_2, e_0_3, e_1_0] })

//         const e_0_0_e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, '0_0_a', true)
//         const e_0_1_e_1_2 = new TestEvent({ global: 1, local: 2 }, e_0_0_e_1_1.id, '0_1_a', true)

//         expectRebase(result)
//         expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_1, e_0_2, e_0_3, e_1_0])
//         expectEventArraysEqual(result.syncLog.pendingEvents.local, [e_0_0_e_1_1, e_0_1_e_1_2])
//         expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1])
//         expect(result.syncLog.backendHead).toBe(ROOT_ID.global)
//       })
//     })
//   })

//   describe('backend origin', () => {
//     const run = ({ syncLog, incomingEvents }: { syncLog: SyncLog<TestEvent>; incomingEvents: TestEvent[] }) =>
//       updateSyncLog({
//         syncLog,
//         incomingEvents,
//         origin: 'backend',
//         isEqualEvent,
//         isLocalEvent: () => true,
//       })

//     describe('pending leader events, no local events', () => {
//       describe('advance', () => {
//         it('should acknowledge pending event when receiving matching backend event', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_0] })

//           expectNoAdvance(result)
//           expect(result.newEvents).toEqual([])
//           expect(result.syncLog).toEqual({ pendingEvents: { leader: [], local: [] }, backendHead: e_0_0.id.global })
//         })

//         it('should acknowledge pending event and add new backend event', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_0, e_0_1] })

//           expectNoAdvance(result)
//           expect(result.newEvents).toEqual([e_0_1])
//           expect(result.syncLog).toEqual({ pendingEvents: { leader: [], local: [] }, backendHead: e_0_1.id.global })
//         })

//         it('should acknowledge pending event and add multiple new backend events', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_0, e_0_1, e_0_2, e_0_3, e_1_0] })

//           expectNoAdvance(result)
//           expect(result.newEvents).toEqual([e_0_1, e_0_2, e_0_3, e_1_0])
//           expect(result.syncLog).toEqual({ pendingEvents: { leader: [], local: [] }, backendHead: e_1_0.id.global })
//         })

//         it('should acknowledge multiple pending events when receiving matching backend events', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0, e_0_1], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_0, e_0_1, e_0_2, e_0_3, e_1_0] })

//           expectNoAdvance(result)
//           expect(result.newEvents).toEqual([e_0_2, e_0_3, e_1_0])
//           expect(result.syncLog).toEqual({ pendingEvents: { leader: [], local: [] }, backendHead: e_1_0.id.global })
//         })
//       })

//       describe('rebase', () => {
//         it('should rebase single pending event to end', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_1] })

//           const e_0_0_e_0_1 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, '0_0_a', true)

//           expectRebase(result)
//           expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_0_e_0_1])
//           expectEventArraysEqual(result.eventsToRollback, [e_0_0])
//           expect(result.syncLog.backendHead).toBe(e_0_1.id.global)
//         })

//         it('should rebase multiple pending events to end', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0, e_0_1], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_1, e_0_2, e_0_3, e_1_0] })

//           const e_0_0_e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, '0_0_a', true)
//           const e_0_1_e_1_2 = new TestEvent({ global: 1, local: 2 }, e_0_0_e_1_1.id, '0_1_a', true)

//           expectRebase(result)
//           expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_0_e_1_1, e_0_1_e_1_2])
//           expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1])
//           expect(result.syncLog.backendHead).toBe(e_1_0.id.global)
//         })

//         it('should only rebase divergent events when first event matches', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0, e_0_1], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_0, e_0_2, e_0_3, e_1_0] })

//           const e_0_1_e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, '0_1_a', true)

//           expectRebase(result)
//           expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_1_e_1_1])
//           expectEventArraysEqual(result.eventsToRollback, [e_0_1])
//           expect(result.syncLog.backendHead).toBe(e_1_0.id.global)
//         })

//         it('should rebase all pending events when incoming chain starts differently', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0, e_0_1], local: [] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_1, e_0_2, e_0_3, e_1_0] })

//           const e_0_0_e_1_1 = new TestEvent({ global: 1, local: 1 }, e_1_0.id, '0_0_a', true)
//           const e_0_1_e_1_2 = new TestEvent({ global: 1, local: 2 }, e_0_0_e_1_1.id, '0_1_a', true)

//           expectRebase(result)
//           expectEventArraysEqual(result.syncLog.pendingEvents.leader, [e_0_0_e_1_1, e_0_1_e_1_2])
//           expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1])
//           expect(result.syncLog.backendHead).toBe(e_1_0.id.global)
//         })
//       })
//     })

//     describe('invalid state', () => {
//       it('should fail for rebase with unconfirmed leader events', () => {
//         const syncLog = { pendingEvents: { leader: [], local: [e_0_0] }, backendHead: ROOT_ID.global }
//         expect(() => run({ syncLog, incomingEvents: [e_0_0] })).toThrow()
//       })

//       it('should fail for rebase with partially unconfirmed leader events', () => {
//         const syncLog = { pendingEvents: { leader: [e_0_0], local: [e_0_1] }, backendHead: ROOT_ID.global }
//         expect(() => run({ syncLog, incomingEvents: [e_0_0, e_0_1] })).toThrow()
//       })
//     })

//     describe('pending leader events, with local events', () => {
//       describe('advance', () => {
//         it('should acknowledge pending event when receiving matching backend event', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0], local: [e_0_1] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_0] })

//           expectNoAdvance(result)
//           expect(result.newEvents).toEqual([])
//           expect(result.syncLog).toEqual({
//             pendingEvents: { leader: [], local: [e_0_1] },
//             backendHead: e_0_0.id.global,
//           })
//         })
//       })

//       describe('rebase', () => {
//         it('should rebase single pending event to end', () => {
//           const syncLog = { pendingEvents: { leader: [e_0_0], local: [e_0_1] }, backendHead: ROOT_ID.global }
//           const result = run({ syncLog, incomingEvents: [e_0_1] })
//           const e_0_0_e_0_1 = new TestEvent({ global: 0, local: 2 }, e_0_1.id, '0_0_a', true)

//           // This case is tricky as it's not clear what to do with the pending leader events.
//           // We could either:
//           // 1. Rebase and treat them as local events
//           // 2. "do nothing" and wait for the leader to send their rebase results

//           expectRebase(result)
//           expectEventArraysEqual(result.syncLog.pendingEvents.leader, [])
//           // expectEventArraysEqual(result.syncLog.pendingEvents.local, [e_0_0_e_0_1])
//           // expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1])
//           expect(result.syncLog.backendHead).toBe(e_0_1.id.global)
//         })
//       })
//     })
//   })
// })

describe('synclog2', () => {
  describe('updateSyncLog2', () => {
    const isLocalEvent = (event: TestEvent) => event.isLocal
    const isEqualEvent = (a: TestEvent, b: TestEvent) =>
      a.id.global === b.id.global && a.id.local === b.id.local && a.payload === b.payload

    const run = ({
      syncLog,
      update,
    }: {
      syncLog: SyncLog2.SyncLogState<TestEvent>
      update: SyncLog2.UpdateFromUpstream<TestEvent>
    }) =>
      SyncLog2.updateSyncLog2({
        syncLog,
        update,
        isLocalEvent,
        isEqualEvent,
        rebase: (args) => args.event.rebase_(args.parentId),
      })

    describe('upstream-rebase', () => {
      it('should rollback until start', () => {
        const syncLog = { pending: [e_1_0], rollbackTail: [e_0_0, e_0_1], upstreamHead: ROOT_ID }
        const e_0_0_e_1_0 = e_0_0.rebase_(e_1_0.id)
        const e_0_1_e_1_1 = e_0_1.rebase_(e_0_0_e_1_0.id)
        const result = run({
          syncLog,
          update: { _tag: 'upstream-rebase', rollbackUntil: e_0_0.id, newEvents: [e_0_0_e_1_0, e_0_1_e_1_1] },
        })
        const e_1_0_e_2_0 = e_1_0.rebase_(e_0_0_e_1_0.id)
        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.syncLog.rollbackTail, [])
        expect(result.syncLog.upstreamHead).toBe(e_0_1_e_1_1.id)
        expectEventArraysEqual(result.newEvents, [e_0_0_e_1_0, e_0_1_e_1_1])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0])
      })

      it('should rollback only to specified point', () => {
        const syncLog = { pending: [e_1_0], rollbackTail: [e_0_0, e_0_1], upstreamHead: ROOT_ID }
        const e_0_1_e_1_0 = e_0_1.rebase_(e_0_0.id)
        const result = run({
          syncLog,
          update: { _tag: 'upstream-rebase', rollbackUntil: e_0_1.id, newEvents: [e_0_1_e_1_0] },
        })
        const e_1_0_e_2_0 = e_1_0.rebase_(e_0_1_e_1_0.id)
        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.syncLog.rollbackTail, [])
        expect(result.syncLog.upstreamHead).toBe(e_0_1_e_1_0.id)
        expectEventArraysEqual(result.newEvents, [e_0_1_e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_1, e_1_0])
      })
    })

    describe('advance', () => {
      it('should acknowledge pending event when receiving matching event', () => {
        const syncLog = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        expectAdvance2(result)
        expectEventArraysEqual(result.syncLog.pending, [])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_0])
        expect(result.syncLog.upstreamHead).toBe(e_0_0.id)
        expect(result.newEvents).toEqual([])
      })

      it('should acknowledge pending event and add new event', () => {
        const syncLog = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_1] } })

        expectAdvance2(result)
        expectEventArraysEqual(result.syncLog.pending, [])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_0, e_0_1])
        expect(result.syncLog.upstreamHead).toBe(e_0_1.id)
        expect(result.newEvents).toEqual([e_0_1])
      })

      it('should acknowledge pending event and add multiple new events', () => {
        const syncLog = { pending: [e_0_1], rollbackTail: [], upstreamHead: e_0_0.id }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] } })

        expectAdvance2(result)
        expectEventArraysEqual(result.syncLog.pending, [])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expect(result.syncLog.upstreamHead).toBe(e_1_0.id)
        expect(result.newEvents).toEqual([e_0_2, e_0_3, e_1_0])
      })
    })

    describe('rebase', () => {
      it('should rebase single local event to end', () => {
        const syncLog = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_1] } })

        const e_0_0_e_0_2 = e_0_0.rebase_(e_0_1.id)

        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_0_0_e_0_2])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_1])
        expect(result.syncLog.upstreamHead).toBe(e_0_1.id)
        expectEventArraysEqual(result.eventsToRollback, [e_0_0])
        expectEventArraysEqual(result.newEvents, [e_0_1, e_0_0_e_0_2])
      })

      it('should rebase different event with same id (no rollback tail)', () => {
        const e_0_0_b = new TestEvent({ global: 0, local: 0 }, ROOT_ID, '0_0_b', true)
        const syncLog = { pending: [e_0_0_b], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_0] } })

        const e_0_0_e_1_0 = e_0_0_b.rebase_(e_0_0.id)

        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_0_0_e_1_0])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_0])
        expectEventArraysEqual(result.newEvents, [e_0_0, e_0_0_e_1_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0_b])
        expect(result.syncLog.upstreamHead).toBe(e_0_0.id)
      })

      it('should rebase different event with same id', () => {
        const e_1_0_b = new TestEvent({ global: 1, local: 0 }, e_0_0.id, '1_0_b', false)
        const syncLog = { pending: [e_1_0_b], rollbackTail: [e_0_0, e_0_1], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_1_0] } })
        const e_1_0_e_2_0 = e_1_0_b.rebase_(e_1_0.id)

        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_1_0_e_2_0])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_0, e_0_1, e_1_0])
        expectEventArraysEqual(result.newEvents, [e_1_0, e_1_0_e_2_0])
        expectEventArraysEqual(result.eventsToRollback, [e_0_0, e_0_1, e_1_0_b])
        expect(result.syncLog.upstreamHead).toBe(e_1_0.id)
      })

      it('should rebase single local event to end (more incoming events)', () => {
        const syncLog = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] } })

        const e_0_0_e_2_0 = e_0_0.rebase_(e_1_0.id)

        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_0_0_e_2_0])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expect(result.syncLog.upstreamHead).toBe(e_1_0.id)
      })

      it('should only rebase divergent events when first event matches', () => {
        const syncLog = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_0, e_0_2, e_0_3, e_1_0] } })

        const e_0_1_e_1_1 = e_0_1.rebase_(e_1_0.id)

        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_0_1_e_1_1])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_0, e_0_2, e_0_3, e_1_0])
        expect(result.syncLog.upstreamHead).toBe(e_1_0.id)
      })

      it('should rebase all local events when incoming chain starts differently', () => {
        const syncLog = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID }
        const result = run({ syncLog, update: { _tag: 'upstream-advance', newEvents: [e_0_1, e_0_2, e_0_3, e_1_0] } })

        const e_0_0_e_1_1 = e_0_0.rebase_(e_1_0.id)
        const e_0_1_e_1_2 = e_0_1.rebase_(e_0_0_e_1_1.id)

        expectRebase2(result)
        expectEventArraysEqual(result.syncLog.pending, [e_0_0_e_1_1, e_0_1_e_1_2])
        expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_1, e_0_2, e_0_3, e_1_0])
        expect(result.syncLog.upstreamHead).toBe(e_1_0.id)
      })

      describe('local-push', () => {
        describe('advance', () => {
          it('should advance with new events', () => {
            const syncLog = { pending: [e_0_0], rollbackTail: [], upstreamHead: ROOT_ID }
            const result = run({ syncLog, update: { _tag: 'local-push', newEvents: [e_0_1, e_0_2, e_0_3] } })

            expectAdvance2(result)
            expectEventArraysEqual(result.syncLog.pending, [e_0_0, e_0_1, e_0_2, e_0_3])
            expectEventArraysEqual(result.syncLog.rollbackTail, [])
            expect(result.syncLog.upstreamHead).toBe(ROOT_ID)
            expectEventArraysEqual(result.newEvents, [e_0_1, e_0_2, e_0_3])
          })
        })

        describe('rebase', () => {
          it('should rebase when new events are greater than pending events', () => {
            const syncLog = { pending: [e_0_0, e_0_1], rollbackTail: [], upstreamHead: ROOT_ID }
            const result = run({ syncLog, update: { _tag: 'local-push', newEvents: [e_0_1, e_0_2] } })

            const e_0_1_e_0_2 = e_0_1.rebase_(e_0_1.id)
            const e_0_2_e_0_3 = e_0_2.rebase_(e_0_1_e_0_2.id)

            expectRebase2(result)
            expectEventArraysEqual(result.syncLog.pending, [e_0_0, e_0_1, e_0_1_e_0_2, e_0_2_e_0_3])
            expectEventArraysEqual(result.syncLog.rollbackTail, [])
            expect(result.syncLog.upstreamHead).toBe(ROOT_ID)
            expectEventArraysEqual(result.newEvents, [e_0_1_e_0_2, e_0_2_e_0_3])
            expectEventArraysEqual(result.eventsToRollback, [])
          })
        })
      })
    })

    it('trim-rollback-tail', () => {
      const syncLog = { pending: [e_1_0], rollbackTail: [e_0_0, e_0_1, e_0_2, e_0_3], upstreamHead: e_0_1.id }
      const result = run({ syncLog, update: { _tag: 'trim-rollback-tail', newRollbackStart: e_0_2.id } })
      expectAdvance2(result)
      expectEventArraysEqual(result.syncLog.pending, [e_1_0])
      expectEventArraysEqual(result.syncLog.rollbackTail, [e_0_2, e_0_3])
      expect(result.syncLog.upstreamHead).toBe(e_0_1.id)
    })
  })

  /**
   * Topology: Session <-(synclog1)-> Leader <-(synclog2)-> Backend
   */
  describe('synclog-network', () => {
    const isLocalEvent = (event: TestEvent) => event.isLocal
    const isEqualEvent = (a: TestEvent, b: TestEvent) =>
      a.id.global === b.id.global && a.id.local === b.id.local && a.payload === b.payload
    const rebase = (args: { event: TestEvent; id: EventId; parentId: EventId }) => args.event.rebase_(args.parentId)

    const e_0_1_b = new TestEvent({ global: 0, local: 1 }, e_0_0.id, '0_1_b', true)

    it('network', () => {
      const network = new SyncLogNetwork(
        [
          {
            nodeId: 'session',
            initialEvents: [e_0_0],
            syncLogState: { pending: [e_0_1_b], rollbackTail: [], upstreamHead: e_0_0.id },
            upstreamNodeId: 'leader',
          },
          {
            nodeId: 'leader',
            initialEvents: [e_0_0],
            syncLogState: { pending: [], rollbackTail: [], upstreamHead: e_0_0.id },
            upstreamNodeId: 'backend',
          },
          {
            nodeId: 'backend',
            initialEvents: [e_0_0],
            syncLogState: { pending: [], rollbackTail: [], upstreamHead: e_0_0.id },
          },
        ],
        isLocalEvent,
        isEqualEvent,
        rebase,
      )

      // Propagate events
      network.propagateEvents('leader', [e_0_1, e_0_2])
      // TODO we need to reconcile that the leader thinks the backend is at e_0_2

      expect(network.toString()).toMatchInlineSnapshot(`
        "Node: session
          Events: [(0,0,a), (0,1,a), (0,2,a)]
          SyncLog:
            Pending: [(0,3,0_1_b)]
            RollbackTail: [(0,1,a), (0,2,a)]
            UpstreamHead: (0,2)

        Node: leader
          Events: [(0,0,a), (0,1,a), (0,2,a)]
          SyncLog:
            Pending: []
            RollbackTail: [(0,1,a), (0,2,a)]
            UpstreamHead: (0,2)

        Node: backend
          Events: [(0,0,a)]
          SyncLog:
            Pending: []
            RollbackTail: []
            UpstreamHead: (0,0)

        "
      `)

      const e_0_2_b = new TestEvent({ global: 0, local: 2 }, e_0_1.id, '0_2_b', false)

      network.setNodeState('backend', { events: [e_0_1, e_0_2_b] })

      network.handleUpstreamRebase({
        fromNodeId: 'backend',
        events: [e_0_2_b],
        rollbackUntil: e_0_2.id,
      })

      expect(network.toString()).toMatchInlineSnapshot(`
        "Node: session
          Events: [(0,0,a), (0,2,0_2_b)]
          SyncLog:
            Pending: [(0,3,0_1_b)]
            RollbackTail: [(0,1,a), (0,2,a)]
            UpstreamHead: (0,2)

        Node: leader
          Events: [(0,0,a), (0,1,a), (0,2,0_2_b)]
          SyncLog:
            Pending: []
            RollbackTail: [(0,1,a), (0,2,a)]
            UpstreamHead: (0,2)

        Node: backend
          Events: [(0,1,a), (0,2,0_2_b)]
          SyncLog:
            Pending: []
            RollbackTail: []
            UpstreamHead: (0,0)

        "
      `)
    })

    it('test', () => {
      type Node = { events: TestEvent[] }
      type Ref<T> = { current: T }

      const updatePendingSynclog = (
        syncLogRef: Ref<SyncLog2.SyncLogState<TestEvent>>,
        events: ReadonlyArray<TestEvent>,
      ) => {
        syncLogRef.current = {
          ...syncLogRef.current,
          pending: [...syncLogRef.current.pending, ...events],
        }
      }

      const triggerNewEvents = ({
        from,
        to,
        syncLogRef,
        upstreamSyncLogRef,
        events,
      }: {
        from: Node
        to: Node
        syncLogRef: Ref<SyncLog2.SyncLogState<TestEvent>>
        upstreamSyncLogRef: Ref<SyncLog2.SyncLogState<TestEvent>> | undefined
        events: ReadonlyArray<TestEvent>
      }) => {
        from.events.push(...events)
        const result = SyncLog2.updateSyncLog2({
          syncLog: syncLogRef.current,
          update: { _tag: 'upstream-advance', newEvents: events },
          isLocalEvent,
          isEqualEvent,
          rebase: (args) => args.event.rebase_(args.parentId),
        })
        if (result._tag === 'advance') {
          // console.log('pushing', result.syncLog.pending)
          to.events.push(...syncLogRef.current.pending, ...result.newEvents)

          if (upstreamSyncLogRef) {
            updatePendingSynclog(upstreamSyncLogRef, events)
          }
        } else {
          // Remove rolled back events from node
          to.events.splice(to.events.length - result.eventsToRollback.length)
          // Add new events
          to.events.push(...result.newEvents)

          if (upstreamSyncLogRef) {
            // TODO: Implement this
            // updatePendingSynclog(upstreamSyncLogRef, result.eventsToRollback)
          }
        }

        syncLogRef.current = result.syncLog
      }

      const triggerRebase = ({
        from,
        to,
        syncLogRef,
        downstream,
        events,
        rollbackUntil,
      }: {
        from: Node
        to: Node
        syncLogRef: Ref<SyncLog2.SyncLogState<TestEvent>>
        downstream: { syncLogRef: Ref<SyncLog2.SyncLogState<TestEvent>>; node: Node } | undefined
        events: ReadonlyArray<TestEvent>
        rollbackUntil: EventId
      }) => {
        const result = SyncLog2.updateSyncLog2({
          syncLog: syncLogRef.current,
          update: { _tag: 'upstream-rebase', rollbackUntil, newEvents: events },
          isLocalEvent,
          isEqualEvent,
          rebase: (args) => args.event.rebase_(args.parentId),
        })

        if (result._tag === 'rebase') {
          syncLogRef.current = result.syncLog

          // Remove rolled back events from node
          to.events.splice(to.events.length - result.eventsToRollback.length)
          // Add new events
          to.events.push(...result.newEvents)

          if (downstream) {
            triggerRebase({
              from: to,
              to: downstream.node,
              syncLogRef: downstream.syncLogRef,
              downstream: undefined,
              events: events,
              rollbackUntil: rollbackUntil,
            })
          }
        } else {
          throw new Error('Expected rebase')
        }
      }

      // session <-> leader
      const sessionLeaderSyncLogRef = {
        current: { pending: [e_0_1], rollbackTail: [], upstreamHead: e_0_0.id },
      } as Ref<SyncLog2.SyncLogState<TestEvent>>
      // leader <-> backend
      const leaderBackendSyncLogRef = { current: { pending: [], rollbackTail: [], upstreamHead: e_0_0.id } } as Ref<
        SyncLog2.SyncLogState<TestEvent>
      >
      const nodes = { session: { events: [e_0_0] }, leader: { events: [e_0_0] }, backend: { events: [e_0_0] } }

      triggerNewEvents({
        from: nodes.leader,
        to: nodes.session,
        events: [e_0_1, e_0_2],
        syncLogRef: sessionLeaderSyncLogRef,
        upstreamSyncLogRef: leaderBackendSyncLogRef,
      })

      expect(nodes.session.events).toEqual([e_0_0, e_0_1, e_0_2])
      expect(nodes.leader.events).toEqual([e_0_0, e_0_1, e_0_2])

      expect(sessionLeaderSyncLogRef.current.pending).toEqual([])
      expect(sessionLeaderSyncLogRef.current.rollbackTail).toEqual([e_0_1, e_0_2])
      expect(sessionLeaderSyncLogRef.current.upstreamHead).toEqual(e_0_2.id)

      expect(leaderBackendSyncLogRef.current.pending).toEqual([e_0_1, e_0_2])
      expect(leaderBackendSyncLogRef.current.rollbackTail).toEqual([])
      expect(leaderBackendSyncLogRef.current.upstreamHead).toEqual(e_0_0.id)

      const e_0_2_b = new TestEvent({ global: 0, local: 2 }, e_0_1.id, '0_2_b', false)
      const e_0_2_e_0_3 = e_0_2.rebase_(e_0_2_b.id)

      // let leader <> backend advance to 0_0_1 but keep 0_0_2 pending
      nodes.backend.events.push(e_0_1, e_0_2_b)
      leaderBackendSyncLogRef.current = {
        pending: [e_0_2],
        rollbackTail: [e_0_1],
        upstreamHead: e_0_1.id,
      }

      triggerRebase({
        from: nodes.backend,
        to: nodes.leader,
        syncLogRef: leaderBackendSyncLogRef,
        downstream: { syncLogRef: sessionLeaderSyncLogRef, node: nodes.session },
        events: [e_0_2_b],
        rollbackUntil: e_0_1.id,
      })

      expectEventArraysEqual(nodes.session.events, [e_0_0, e_0_2_b])
      expectEventArraysEqual(nodes.leader.events, [e_0_0, e_0_2_b])
      expectEventArraysEqual(nodes.backend.events, [e_0_0, e_0_1, e_0_2_b])

      expectEventArraysEqual(sessionLeaderSyncLogRef.current.pending, [])
      expectEventArraysEqual(sessionLeaderSyncLogRef.current.rollbackTail, [])
      expect(sessionLeaderSyncLogRef.current.upstreamHead).toEqual(e_0_2_b.id)

      expectEventArraysEqual(leaderBackendSyncLogRef.current.pending, [e_0_2_e_0_3])
      expectEventArraysEqual(leaderBackendSyncLogRef.current.rollbackTail, [])
      expect(leaderBackendSyncLogRef.current.upstreamHead).toEqual(e_0_2_b.id)
    })
  })
})

function expectNoAdvance(result: UpdateResult<TestEvent>): asserts result is UpdateResultAdvance<TestEvent> {
  expect(result._tag).toBe('advance')
}

function expectRebase(result: UpdateResult<TestEvent>): asserts result is UpdateResultRebase<TestEvent> {
  expect(result._tag).toBe('rebase')
}

const expectEventArraysEqual = (actual: ReadonlyArray<TestEvent>, expected: ReadonlyArray<TestEvent>) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((event, i) => {
    expect(event.id).toEqual(expected[i]!.id)
    expect(event.parentId).toEqual(expected[i]!.parentId)
    expect(event.payload).toEqual(expected[i]!.payload)
  })
}

function expectAdvance2(
  result: SyncLog2.UpdateResult2<TestEvent>,
): asserts result is SyncLog2.UpdateResult2Advance<TestEvent> {
  expect(result._tag).toBe('advance')
}

function expectRebase2(
  result: SyncLog2.UpdateResult2<TestEvent>,
): asserts result is SyncLog2.UpdateResult2Rebase<TestEvent> {
  expect(result._tag).toBe('rebase')
}
