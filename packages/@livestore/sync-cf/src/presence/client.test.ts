import { describe, expect, it } from '@effect/vitest'

import { mergePresencePatch } from './client.ts'
import { DEFAULT_PRESENCE_ROOM_ID } from './schema.ts'

describe('mergePresencePatch', () => {
  it('merges new fields onto existing state', () => {
    expect(mergePresencePatch({ name: 'Ada' }, { cursor: { x: 1, y: 2 } })).toEqual({
      name: 'Ada',
      cursor: { x: 1, y: 2 },
    })
  })

  it('overwrites an existing field', () => {
    expect(mergePresencePatch({ name: 'Ada' }, { name: 'Grace' })).toEqual({ name: 'Grace' })
  })

  it('deletes keys set to null or undefined', () => {
    expect(mergePresencePatch({ name: 'Ada', dragging: { cardId: 'c1' } }, { dragging: null })).toEqual({
      name: 'Ada',
    })
    expect(mergePresencePatch({ name: 'Ada', dragging: { cardId: 'c1' } }, { dragging: undefined })).toEqual({
      name: 'Ada',
    })
  })

  it('does not mutate the previous object', () => {
    const prev = { name: 'Ada' }
    mergePresencePatch(prev, { name: 'Grace' })
    expect(prev).toEqual({ name: 'Ada' })
  })
})

describe('DEFAULT_PRESENCE_ROOM_ID', () => {
  it('is default so single-room apps need no extra config', () => {
    expect(DEFAULT_PRESENCE_ROOM_ID).toBe('default')
  })
})
