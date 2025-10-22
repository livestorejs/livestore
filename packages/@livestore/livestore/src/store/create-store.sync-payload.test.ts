import { resolveSyncPayload } from './create-store.ts'
import { Effect, Schema } from '@livestore/utils/effect'
import { describe, expect, it } from 'vitest'

describe('resolveSyncPayload', () => {
  it('decodes and encodes using the provided schema', async () => {
    const payloadSchema = Schema.Struct({ amount: Schema.NumberFromString })
    const result = await resolveSyncPayload(payloadSchema, { amount: 42 }).pipe(Effect.runPromise)

    expect(result.decoded).toEqual({ amount: 42 })
    expect(result.encoded).toEqual({ amount: '42' })
  })

  it('returns undefined values when payload is missing', async () => {
    const result = await resolveSyncPayload(Schema.JsonValue, undefined).pipe(Effect.runPromise)

    expect(result).toEqual({ decoded: undefined, encoded: undefined })
  })

  it('fails when payload cannot be decoded', async () => {
    const payloadSchema = Schema.Struct({ count: Schema.Number })

    await expect(
      resolveSyncPayload(payloadSchema, { count: 'not-a-number' } as unknown as { count: number }).pipe(Effect.runPromise),
    ).rejects.toThrowError()
  })
})
