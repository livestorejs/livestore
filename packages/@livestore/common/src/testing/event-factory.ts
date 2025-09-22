/**
 * Helpers for synthesizing LiveStore events in tests while keeping track of
 * sequence numbers, parent pointers, and authoring client identity. Inspired
 * by the effect-based schema utilities, the factory exposes a namespaced API
 * where each event definition maps to a helper with `next`, `advanceTo`, and
 * `setParent` functions that share a single sequence stream.
 *
 * @example
 * ```ts
 * import { EventFactory } from '@livestore/common/testing'
 * import { events } from './schema'
 *
 * const eventFactory = EventFactory.makeFactory(events)({
 *   client: EventFactory.clientIdentity('test-client'),
 *   startSeq: 1,
 *   initialParent: 'root',
 * })
 *
 * const bootstrap = eventFactory.todoCreated.next({
 *   id: 'todo-1',
 *   text: 'write tests',
 *   completed: false,
 * })
 *
 * eventFactory.todoCreated.advanceTo(42)
 * const branched = eventFactory.todoUpdated.next({
 *   id: 'todo-1',
 *   text: 'ship feature',
 *   completed: true,
 * })
 * ```
 */

import { Schema } from '@livestore/utils/effect'

import type { EventDef } from '../schema/EventDef.ts'
import * as EventSequenceNumber from '../schema/EventSequenceNumber.ts'
import * as LiveStoreEvent from '../schema/LiveStoreEvent.ts'

export interface ClientIdentity {
  clientId: string
  sessionId: string
}

export const clientIdentity = (label: string, session = `${label}-session`): ClientIdentity => ({
  clientId: label,
  sessionId: session,
})

export type SequenceValue = 'root' | number

type EventFactoriesArgs<TDefs extends Record<string, EventDef.Any>> = {
  [K in keyof TDefs]: Parameters<TDefs[K]>[0]
}

type EventFactories<TDefs extends Record<string, EventDef.Any>, TResult> = {
  [K in keyof TDefs]: {
    next: (args: EventFactoriesArgs<TDefs>[K]) => TResult
    advanceTo: (seq: number, parent?: SequenceValue) => void
    setParent: (parent: SequenceValue) => void
    current: () => { seq: number; parent: SequenceValue }
  }
}

export interface EventFactoriesConfig {
  client: ClientIdentity
  /**
   * @default 1
   */
  startSeq?: number
  /**
   * @default 0 (root)
   */
  initialParent?: SequenceValue
}

export const makeFactory =
  <TDefs extends Record<string, EventDef.Any>>(eventDefs: TDefs) =>
  ({
    client,
    startSeq = 1,
    initialParent = 'root',
  }: EventFactoriesConfig): EventFactories<TDefs, LiveStoreEvent.AnyEncodedGlobal> => {
    let nextSeq = startSeq
    let parentRef: SequenceValue = initialParent

    const advanceTo = (seq: number, parent: SequenceValue = 'root') => {
      nextSeq = seq
      parentRef = parent
    }

    const setParent = (parent: SequenceValue) => {
      parentRef = parent
    }

    const current = () => ({ seq: nextSeq, parent: parentRef })

    const factories: Partial<EventFactories<TDefs, LiveStoreEvent.AnyEncodedGlobal>> = {}

    for (const [name, eventDef] of Object.entries(eventDefs) as [keyof TDefs, TDefs[keyof TDefs]][]) {
      const next = (args: EventFactoriesArgs<TDefs>[typeof name]) => {
        const decoded = eventDef(args)
        const encodedArgs = Schema.encodeSync(eventDef.schema)(decoded.args)
        const encoded = eventDef.encoded(encodedArgs)

        const event = LiveStoreEvent.AnyEncodedGlobal.make({
          name: encoded.name,
          args: encoded.args,
          seqNum: EventSequenceNumber.globalEventSequenceNumber(nextSeq),
          parentSeqNum:
            parentRef === 'root'
              ? EventSequenceNumber.ROOT.global
              : EventSequenceNumber.globalEventSequenceNumber(parentRef),
          clientId: client.clientId,
          sessionId: client.sessionId,
        })

        parentRef = nextSeq
        nextSeq = nextSeq + 1

        return event
      }

      factories[name] = {
        next,
        advanceTo,
        setParent,
        current,
      } as EventFactories<TDefs, LiveStoreEvent.AnyEncodedGlobal>[typeof name]
    }

    return factories as EventFactories<TDefs, LiveStoreEvent.AnyEncodedGlobal>
  }
