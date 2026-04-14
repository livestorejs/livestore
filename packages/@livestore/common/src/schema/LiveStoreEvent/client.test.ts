import { expect } from 'vitest'

import { Option } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'

import * as EventSequenceNumber from '../EventSequenceNumber/mod.ts'
import { EncodedWithMeta } from './client.ts'

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
