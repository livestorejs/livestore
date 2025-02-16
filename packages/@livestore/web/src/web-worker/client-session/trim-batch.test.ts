import type { MutationEvent } from '@livestore/common/schema'
import { EventId } from '@livestore/common/schema'
import { describe, expect, it } from 'vitest'

import { trimPushBatch } from './trim-batch.js'

describe('trimPushBatch', () => {
  it('should return same batch', () => {
    const batch = [
      { id: EventId.make({ global: 0, local: 1 }), parentId: EventId.make({ global: 0, local: 0 }) },
      { id: EventId.make({ global: 0, local: 2 }), parentId: EventId.make({ global: 0, local: 1 }) },
      { id: EventId.make({ global: 1, local: 0 }), parentId: EventId.make({ global: 0, local: 0 }) },
      { id: EventId.make({ global: 1, local: 1 }), parentId: EventId.make({ global: 1, local: 0 }) },
    ] as MutationEvent.AnyEncoded[]

    const trimmed = trimPushBatch(batch)

    expect(trimmed).toEqual(batch)
  })

  it('should trim the batch', () => {
    const batch = [
      { id: EventId.make({ global: 0, local: 1 }), parentId: EventId.make({ global: 0, local: 0 }) },
      { id: EventId.make({ global: 0, local: 2 }), parentId: EventId.make({ global: 0, local: 1 }) },
      // should trim above
      { id: EventId.make({ global: 0, local: 1 }), parentId: EventId.make({ global: 0, local: 0 }) },
      { id: EventId.make({ global: 0, local: 2 }), parentId: EventId.make({ global: 0, local: 1 }) },
      { id: EventId.make({ global: 1, local: 0 }), parentId: EventId.make({ global: 0, local: 0 }) },
      { id: EventId.make({ global: 1, local: 1 }), parentId: EventId.make({ global: 1, local: 0 }) },
    ] as MutationEvent.AnyEncoded[]

    const trimmed = trimPushBatch(batch)

    expect(trimmed).toEqual(batch.slice(2))
  })

  it('should trim the batch', () => {
    const batch = [
      { id: EventId.make({ global: 0, local: 1 }), parentId: EventId.make({ global: 0, local: 0 }) },
      // should trim above
      { id: EventId.make({ global: 0, local: 1 }), parentId: EventId.make({ global: 0, local: 0 }) },
    ] as MutationEvent.AnyEncoded[]

    const trimmed = trimPushBatch(batch)

    expect(trimmed).toEqual(batch.slice(1))
  })
})
