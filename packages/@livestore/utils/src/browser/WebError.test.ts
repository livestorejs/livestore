import * as Vitest from '@effect/vitest'

import * as WebError from './WebError.ts'

Vitest.describe('parseWebError', () => {
  Vitest.it('returns a WebError instance unchanged when no expectations are provided', () => {
    const domException = new DOMException('missing node', 'NotFoundError')
    const webError = new WebError.NotFoundError({ cause: domException })

    const result = WebError.parseWebError(webError)

    Vitest.expect(result).toBeInstanceOf(WebError.NotFoundError)
    Vitest.expect(result.cause).toBe(domException)
  })

  Vitest.it('maps native errors to the corresponding WebError when expected', () => {
    const nativeError = new globalThis.TypeError('unsupported type')

    const result = WebError.parseWebError(nativeError, [WebError.TypeError])

    Vitest.expect(result).toBeInstanceOf(WebError.TypeError)
    Vitest.expect(result.cause).toBe(nativeError)
  })

  Vitest.it('wraps parsed errors that are not in the expected list in UnknownError', () => {
    const nativeError = new globalThis.RangeError('value out of range')

    const result = WebError.parseWebError(nativeError, [WebError.TypeError])

    Vitest.expect(result).toBeInstanceOf(WebError.UnknownError)
    Vitest.expect(result.cause).toBeInstanceOf(WebError.RangeError)
  })

  Vitest.it('translates DOMException names into the matching WebError variant', () => {
    const domException = new DOMException('permission denied', 'NotAllowedError')

    const result = WebError.parseWebError(domException, [WebError.NotAllowedError])

    Vitest.expect(result).toBeInstanceOf(WebError.NotAllowedError)
    Vitest.expect(result.cause).toBe(domException)
  })

  Vitest.it('produces UnknownError for non-error values with the default message', () => {
    const value = { reason: 'unexpected' }

    const result = WebError.parseWebError(value)

    Vitest.expect(result).toBeInstanceOf(WebError.UnknownError)
    Vitest.expect(result.cause).toBeDefined()
    Vitest.expect(result.message).toBe('A web error occurred')
  })

  Vitest.it('returns UnknownError instances without altering their payload when expectations are provided', () => {
    const existing = new WebError.UnknownError({ description: 'pre-parsed' })

    const result = WebError.parseWebError(existing, [WebError.TypeError])

    Vitest.expect(result).toBeInstanceOf(WebError.UnknownError)

    if (!(result instanceof WebError.UnknownError)) {
      throw new Error('Expected an UnknownError instance')
    }

    Vitest.expect(result.description).toBe('pre-parsed')
  })
})
