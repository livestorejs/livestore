import { Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'
import * as Api from './api-schema.ts'
import { decodePullArgsFromSearchParams } from './make-s2-url.ts'
import { s2SeqNum } from './types.ts'

describe('ApiSchema', () => {
  it('encodes and decodes PullArgs via args search param', () => {
    const args = Api.PullArgs.make({ storeId: 'store-1', s2SeqNum: s2SeqNum(42), live: true, payload: { a: 1 } })
    const encoded = Schema.encodeSync(Api.ArgsSchema)(args)
    const sp = new URLSearchParams({ args: encoded })
    const roundtrip = decodePullArgsFromSearchParams(sp)
    expect(roundtrip).toEqual(args)
  })

  it('decodes PushPayload with typed events', () => {
    const payload = Api.PushPayload.make({ storeId: 's', batch: [] })
    const decoded = Schema.decodeUnknownEither(Api.PushPayload)(payload)
    expect(decoded._tag).toBe('Right')
  })
})
