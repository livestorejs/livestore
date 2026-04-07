import { expect } from 'vitest'

import { Option } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'

import * as EventSequenceNumber from '../EventSequenceNumber/mod.ts'
import { EncodedWithMeta, isEqualEncoded, Encoded } from './client.ts'

Vitest.describe('EncodedWithMeta', () => {
  Vitest.test('toGlobal() produces numeric seqNums through JSON.stringify', () => {
    const event = new EncodedWithMeta({
      name: 'test-v1',
      args: { id: '1' },
      seqNum: EventSequenceNumber.Client.Composite.make({ global: 5, client: 0 }),
      parentSeqNum: EventSequenceNumber.Client.Composite.make({ global: 4, client: 0 }),
      clientId: 'client-1',
      sessionId: 'session-1',
      meta: {
        sessionChangeset: { _tag: 'unset' },
        syncMetadata: Option.none(),
        materializerHashLeader: Option.none(),
        materializerHashSession: Option.none(),
      },
    })

    const global = event.toGlobal()
    const parsed = JSON.parse(JSON.stringify(global))

    expect(parsed.seqNum).toBe(5)
    expect(parsed.parentSeqNum).toBe(4)
  })
})

Vitest.describe('isEqualEncoded', () => {
  const makeEncodedEvent = (args: unknown): Encoded => ({
    name: 'testEvent-v1',
    args,
    seqNum: EventSequenceNumber.Client.Composite.make({ global: 1, client: 0 }),
    parentSeqNum: EventSequenceNumber.Client.Composite.make(EventSequenceNumber.Client.ROOT),
    clientId: 'client-1',
    sessionId: 'session-1',
  })

  Vitest.it('should consider events with identical args as equal', () => {
    const a = makeEncodedEvent({ id: 'abc', text: 'hello' })
    const b = makeEncodedEvent({ id: 'abc', text: 'hello' })
    expect(isEqualEncoded(a, b)).toBe(true)
  })

  Vitest.it('should consider events with different key order in args as equal', () => {
    const a = makeEncodedEvent({ b: 2, a: 1 })
    const b = makeEncodedEvent({ a: 1, b: 2 })
    expect(isEqualEncoded(a, b)).toBe(true)
  })

  Vitest.it('should consider events with different key order in nested args as equal', () => {
    const a = makeEncodedEvent({ outer: { b: 2, a: 1 }, x: 'y' })
    const b = makeEncodedEvent({ x: 'y', outer: { a: 1, b: 2 } })
    expect(isEqualEncoded(a, b)).toBe(true)
  })

  Vitest.it('should consider events with different args values as not equal', () => {
    const a = makeEncodedEvent({ id: 'abc' })
    const b = makeEncodedEvent({ id: 'def' })
    expect(isEqualEncoded(a, b)).toBe(false)
  })

  Vitest.it('should consider events with different args keys as not equal', () => {
    const a = makeEncodedEvent({ a: 1 })
    const b = makeEncodedEvent({ b: 1 })
    expect(isEqualEncoded(a, b)).toBe(false)
  })

  Vitest.it('should handle null args', () => {
    const a = makeEncodedEvent(null)
    const b = makeEncodedEvent(null)
    expect(isEqualEncoded(a, b)).toBe(true)
  })

  Vitest.it('should handle array args', () => {
    const a = makeEncodedEvent([1, 2, 3])
    const b = makeEncodedEvent([1, 2, 3])
    expect(isEqualEncoded(a, b)).toBe(true)
  })

  Vitest.it('should handle empty object args', () => {
    const a = makeEncodedEvent({})
    const b = makeEncodedEvent({})
    expect(isEqualEncoded(a, b)).toBe(true)
  })

  Vitest.it('should consider events with different names as not equal', () => {
    const a = { ...makeEncodedEvent({ id: 'abc' }), name: 'eventA' }
    const b = { ...makeEncodedEvent({ id: 'abc' }), name: 'eventB' }
    expect(isEqualEncoded(a, b)).toBe(false)
  })
})
