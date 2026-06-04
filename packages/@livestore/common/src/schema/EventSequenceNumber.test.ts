import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { EventSequenceNumber } from './mod.ts'

Vitest.describe('EventSequenceNumber', () => {
  Vitest.test('nextPair (no rebase)', () => {
    const e_0_0 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 0 })
    expect(EventSequenceNumber.Client.nextPair({ seqNum: e_0_0, isClient: false }).seqNum).toStrictEqual({
      global: 1,
      client: 0,
      rebaseGeneration: 0,
    })
    expect(EventSequenceNumber.Client.nextPair({ seqNum: e_0_0, isClient: true }).seqNum).toStrictEqual({
      global: 0,
      client: 1,
      rebaseGeneration: 0,
    })
  })

  Vitest.test('nextPair (rebase)', () => {
    const e_0_0 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 0 })
    expect(
      EventSequenceNumber.Client.nextPair({ seqNum: e_0_0, isClient: false, rebaseGeneration: 1 }).seqNum,
    ).toStrictEqual({
      global: 1,
      client: 0,
      rebaseGeneration: 1,
    })
    expect(
      EventSequenceNumber.Client.nextPair({ seqNum: e_0_0, isClient: true, rebaseGeneration: 1 }).seqNum,
    ).toStrictEqual({
      global: 0,
      client: 1,
      rebaseGeneration: 1,
    })

    const e_0_0_g1 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 0, rebaseGeneration: 2 })
    expect(EventSequenceNumber.Client.nextPair({ seqNum: e_0_0_g1, isClient: false }).seqNum).toStrictEqual({
      global: 1,
      client: 0,
      rebaseGeneration: 2,
    })
  })

  Vitest.test('toString', () => {
    expect(
      EventSequenceNumber.Client.toString(EventSequenceNumber.Client.Composite.make({ global: 0, client: 0 })),
    ).toBe('e0')
    expect(
      EventSequenceNumber.Client.toString(
        EventSequenceNumber.Client.Composite.make({ global: 0, client: 0, rebaseGeneration: 1 }),
      ),
    ).toBe('e0r1')
    expect(
      EventSequenceNumber.Client.toString(EventSequenceNumber.Client.Composite.make({ global: 0, client: 1 })),
    ).toBe('e0.1')
    expect(
      EventSequenceNumber.Client.toString(
        EventSequenceNumber.Client.Composite.make({ global: 0, client: 1, rebaseGeneration: 1 }),
      ),
    ).toBe('e0.1r1')
    expect(
      EventSequenceNumber.Client.toString(
        EventSequenceNumber.Client.Composite.make({ global: 5, client: 3, rebaseGeneration: 2 }),
      ),
    ).toBe('e5.3r2')
  })

  Vitest.test('fromString', () => {
    // Basic cases
    expect(EventSequenceNumber.Client.fromString('e0')).toStrictEqual(
      EventSequenceNumber.Client.Composite.make({ global: 0, client: 0 }),
    )
    expect(EventSequenceNumber.Client.fromString('e0r1')).toStrictEqual(
      EventSequenceNumber.Client.Composite.make({ global: 0, client: 0, rebaseGeneration: 1 }),
    )
    expect(EventSequenceNumber.Client.fromString('e0.1')).toStrictEqual(
      EventSequenceNumber.Client.Composite.make({ global: 0, client: 1 }),
    )
    expect(EventSequenceNumber.Client.fromString('e0.1r1')).toStrictEqual(
      EventSequenceNumber.Client.Composite.make({ global: 0, client: 1, rebaseGeneration: 1 }),
    )
    expect(EventSequenceNumber.Client.fromString('e5.3r2')).toStrictEqual(
      EventSequenceNumber.Client.Composite.make({ global: 5, client: 3, rebaseGeneration: 2 }),
    )

    // Error cases
    expect(() => EventSequenceNumber.Client.fromString('0')).toThrow(
      'Invalid event sequence number string: must start with "e"',
    )
    expect(() => EventSequenceNumber.Client.fromString('eabc')).toThrow(
      'Invalid event sequence number string: invalid number format',
    )
    expect(() => EventSequenceNumber.Client.fromString('e0.abc')).toThrow(
      'Invalid event sequence number string: invalid number format',
    )
    expect(() => EventSequenceNumber.Client.fromString('e0rabc')).toThrow(
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
      const original = EventSequenceNumber.Client.Composite.make(testCase)
      const str = EventSequenceNumber.Client.toString(original)
      const parsed = EventSequenceNumber.Client.fromString(str)
      expect(parsed).toStrictEqual(original)
    }
  })

  Vitest.test('compare', () => {
    const e_0_0_r0 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 0, rebaseGeneration: 0 })
    const e_0_0_r1 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 0, rebaseGeneration: 1 })
    const e_0_1_r0 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 1, rebaseGeneration: 0 })
    const e_0_1_r1 = EventSequenceNumber.Client.Composite.make({ global: 0, client: 1, rebaseGeneration: 1 })
    const e_1_0_r0 = EventSequenceNumber.Client.Composite.make({ global: 1, client: 0, rebaseGeneration: 0 })
    const e_1_1_r0 = EventSequenceNumber.Client.Composite.make({ global: 1, client: 1, rebaseGeneration: 0 })

    // Global comparison (strongest level)
    expect(EventSequenceNumber.Client.compare(e_0_0_r0, e_1_0_r0)).toBeLessThan(0)
    expect(EventSequenceNumber.Client.compare(e_1_0_r0, e_0_0_r0)).toBeGreaterThan(0)
    expect(EventSequenceNumber.Client.compare(e_0_1_r1, e_1_0_r0)).toBeLessThan(0) // global overrides client and rebase

    // Client comparison (second level)
    expect(EventSequenceNumber.Client.compare(e_0_0_r0, e_0_1_r0)).toBeLessThan(0)
    expect(EventSequenceNumber.Client.compare(e_0_1_r0, e_0_0_r0)).toBeGreaterThan(0)
    expect(EventSequenceNumber.Client.compare(e_0_0_r1, e_0_1_r0)).toBeLessThan(0) // client overrides rebase

    // Rebase generation comparison (weakest level)
    expect(EventSequenceNumber.Client.compare(e_0_0_r0, e_0_0_r1)).toBeLessThan(0)
    expect(EventSequenceNumber.Client.compare(e_0_0_r1, e_0_0_r0)).toBeGreaterThan(0)

    // Equal comparison
    expect(EventSequenceNumber.Client.compare(e_0_0_r0, e_0_0_r0)).toBe(0)
    expect(EventSequenceNumber.Client.compare(e_1_1_r0, e_1_1_r0)).toBe(0)
  })
})
