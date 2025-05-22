import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

import { EventSequenceNumber } from './mod.js'

Vitest.describe('EventSequenceNumber', () => {
  Vitest.test('nextPair', () => {
    const e_0_0 = EventSequenceNumber.make({ global: 0, client: 0 })
    expect(EventSequenceNumber.nextPair(e_0_0, false).seqNum).toStrictEqual({ global: 1, client: 0 })
    expect(EventSequenceNumber.nextPair(e_0_0, true).seqNum).toStrictEqual({ global: 0, client: 1 })
  })
})
