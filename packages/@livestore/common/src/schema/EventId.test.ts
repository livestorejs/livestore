import { Vitest } from '@livestore/utils/node-vitest'
import { expect } from 'vitest'

import { EventId } from './mod.js'

Vitest.describe('EventId', () => {
  Vitest.test('nextPair', () => {
    const e_0_0 = EventId.make({ global: 0, client: 0 })
    expect(EventId.nextPair(e_0_0, false).id).toStrictEqual({ global: 1, client: 0 })
    expect(EventId.nextPair(e_0_0, true).id).toStrictEqual({ global: 0, client: 1 })
  })
})
