import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { EventSequenceNumber } from './mod.js'

Vitest.describe('EventSequenceNumber', () => {
  Vitest.test('nextPair (no rebase)', () => {
    const e_0_0 = EventSequenceNumber.make({ global: 0, client: 0 })
    expect(EventSequenceNumber.nextPair({ seqNum: e_0_0, isClient: false }).seqNum).toStrictEqual({
      global: 1,
      client: 0,
      rebaseGeneration: 0,
    })
    expect(EventSequenceNumber.nextPair({ seqNum: e_0_0, isClient: true }).seqNum).toStrictEqual({
      global: 0,
      client: 1,
      rebaseGeneration: 0,
    })
  })

  Vitest.test('nextPair (rebase)', () => {
    const e_0_0 = EventSequenceNumber.make({ global: 0, client: 0 })
    expect(EventSequenceNumber.nextPair({ seqNum: e_0_0, isClient: false, rebaseGeneration: 1 }).seqNum).toStrictEqual({
      global: 1,
      client: 0,
      rebaseGeneration: 1,
    })
    expect(EventSequenceNumber.nextPair({ seqNum: e_0_0, isClient: true, rebaseGeneration: 1 }).seqNum).toStrictEqual({
      global: 0,
      client: 1,
      rebaseGeneration: 1,
    })

    const e_0_0_g1 = EventSequenceNumber.make({ global: 0, client: 0, rebaseGeneration: 2 })
    expect(EventSequenceNumber.nextPair({ seqNum: e_0_0_g1, isClient: false }).seqNum).toStrictEqual({
      global: 1,
      client: 0,
      rebaseGeneration: 2,
    })
  })

  Vitest.test('toString', () => {
    expect(EventSequenceNumber.toString(EventSequenceNumber.make({ global: 0, client: 0 }))).toBe('e0')
    expect(EventSequenceNumber.toString(EventSequenceNumber.make({ global: 0, client: 0, rebaseGeneration: 1 }))).toBe(
      'e0r1',
    )
    expect(EventSequenceNumber.toString(EventSequenceNumber.make({ global: 0, client: 1 }))).toBe('e0+1')
    expect(EventSequenceNumber.toString(EventSequenceNumber.make({ global: 0, client: 1, rebaseGeneration: 1 }))).toBe(
      'e0+1r1',
    )
    expect(EventSequenceNumber.toString(EventSequenceNumber.make({ global: 5, client: 3, rebaseGeneration: 2 }))).toBe(
      'e5+3r2',
    )
  })

  Vitest.test('fromString', () => {
    // Basic cases
    expect(EventSequenceNumber.fromString('e0')).toStrictEqual(EventSequenceNumber.make({ global: 0, client: 0 }))
    expect(EventSequenceNumber.fromString('e0r1')).toStrictEqual(
      EventSequenceNumber.make({ global: 0, client: 0, rebaseGeneration: 1 }),
    )
    expect(EventSequenceNumber.fromString('e0+1')).toStrictEqual(EventSequenceNumber.make({ global: 0, client: 1 }))
    expect(EventSequenceNumber.fromString('e0+1r1')).toStrictEqual(
      EventSequenceNumber.make({ global: 0, client: 1, rebaseGeneration: 1 }),
    )
    expect(EventSequenceNumber.fromString('e5+3r2')).toStrictEqual(
      EventSequenceNumber.make({ global: 5, client: 3, rebaseGeneration: 2 }),
    )

    // Error cases
    expect(() => EventSequenceNumber.fromString('0')).toThrow(
      'Invalid event sequence number string: must start with "e"',
    )
    expect(() => EventSequenceNumber.fromString('eabc')).toThrow(
      'Invalid event sequence number string: invalid number format',
    )
    expect(() => EventSequenceNumber.fromString('e0+abc')).toThrow(
      'Invalid event sequence number string: invalid number format',
    )
    expect(() => EventSequenceNumber.fromString('e0rabc')).toThrow(
      'Invalid event sequence number string: invalid number format',
    )
  })

  Vitest.test('toString/fromString roundtrip', () => {
    const testCases = [
      { global: 0, client: 0, rebaseGeneration: 0 },
      { global: 0, client: 0, rebaseGeneration: 1 },
      { global: 0, client: 1, rebaseGeneration: 0 },
      { global: 0, client: 1, rebaseGeneration: 1 },
      { global: 5, client: 3, rebaseGeneration: 2 },
      { global: 100, client: 50, rebaseGeneration: 10 },
    ]

    for (const testCase of testCases) {
      const original = EventSequenceNumber.make(testCase)
      const str = EventSequenceNumber.toString(original)
      const parsed = EventSequenceNumber.fromString(str)
      expect(parsed).toStrictEqual(original)
    }
  })

  Vitest.test('compare', () => {
    const e_0_0_r0 = EventSequenceNumber.make({ global: 0, client: 0, rebaseGeneration: 0 })
    const e_0_0_r1 = EventSequenceNumber.make({ global: 0, client: 0, rebaseGeneration: 1 })
    const e_0_1_r0 = EventSequenceNumber.make({ global: 0, client: 1, rebaseGeneration: 0 })
    const e_0_1_r1 = EventSequenceNumber.make({ global: 0, client: 1, rebaseGeneration: 1 })
    const e_1_0_r0 = EventSequenceNumber.make({ global: 1, client: 0, rebaseGeneration: 0 })
    const e_1_1_r0 = EventSequenceNumber.make({ global: 1, client: 1, rebaseGeneration: 0 })

    // Global comparison (strongest level)
    expect(EventSequenceNumber.compare(e_0_0_r0, e_1_0_r0)).toBeLessThan(0)
    expect(EventSequenceNumber.compare(e_1_0_r0, e_0_0_r0)).toBeGreaterThan(0)
    expect(EventSequenceNumber.compare(e_0_1_r1, e_1_0_r0)).toBeLessThan(0) // global overrides client and rebase

    // Client comparison (second level)
    expect(EventSequenceNumber.compare(e_0_0_r0, e_0_1_r0)).toBeLessThan(0)
    expect(EventSequenceNumber.compare(e_0_1_r0, e_0_0_r0)).toBeGreaterThan(0)
    expect(EventSequenceNumber.compare(e_0_0_r1, e_0_1_r0)).toBeLessThan(0) // client overrides rebase

    // Rebase generation comparison (weakest level)
    expect(EventSequenceNumber.compare(e_0_0_r0, e_0_0_r1)).toBeLessThan(0)
    expect(EventSequenceNumber.compare(e_0_0_r1, e_0_0_r0)).toBeGreaterThan(0)

    // Equal comparison
    expect(EventSequenceNumber.compare(e_0_0_r0, e_0_0_r0)).toBe(0)
    expect(EventSequenceNumber.compare(e_1_1_r0, e_1_1_r0)).toBe(0)
  })
})
