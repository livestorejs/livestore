import * as Vitest from '@effect/vitest'

import * as BrowserError from './BrowserError.ts'

Vitest.describe('parseBrowserError', () => {
  Vitest.it('returns a BrowserError instance unchanged when no expectations are provided', () => {
    const domException = new DOMException('missing node', 'NotFoundError')
    const browserError = new BrowserError.NotFoundError({ cause: domException })

    const result = BrowserError.parseBrowserError(browserError)

    Vitest.expect(result).toBeInstanceOf(BrowserError.NotFoundError)
    Vitest.expect(result.cause).toBe(domException)
  })

  Vitest.it('maps native errors to the corresponding BrowserError when expected', () => {
    const nativeError = new globalThis.TypeError('unsupported type')

    const result = BrowserError.parseBrowserError(nativeError, [BrowserError.TypeError])

    Vitest.expect(result).toBeInstanceOf(BrowserError.TypeError)
    Vitest.expect(result.cause).toBe(nativeError)
  })

  Vitest.it('wraps parsed errors that are not in the expected list in UnknownError', () => {
    const nativeError = new globalThis.RangeError('value out of range')

    const result = BrowserError.parseBrowserError(nativeError, [BrowserError.TypeError])

    Vitest.expect(result).toBeInstanceOf(BrowserError.UnknownError)
    Vitest.expect(result.cause).toBeInstanceOf(BrowserError.RangeError)
  })

  Vitest.it('translates DOMException names into the matching BrowserError variant', () => {
    const domException = new DOMException('permission denied', 'NotAllowedError')

    const result = BrowserError.parseBrowserError(domException, [BrowserError.NotAllowedError])

    Vitest.expect(result).toBeInstanceOf(BrowserError.NotAllowedError)
    Vitest.expect(result.cause).toBe(domException)
  })

  Vitest.it('produces UnknownError for non-error values with the default message', () => {
    const value = { reason: 'unexpected' }

    const result = BrowserError.parseBrowserError(value)

    Vitest.expect(result).toBeInstanceOf(BrowserError.UnknownError)
    Vitest.expect(result.cause).toBeDefined()
    Vitest.expect(result.message).toBe('A browser error occurred')
  })

  Vitest.it('returns UnknownError instances without altering their payload when expectations are provided', () => {
    const existing = new BrowserError.UnknownError({ description: 'pre-parsed' })

    const result = BrowserError.parseBrowserError(existing, [BrowserError.TypeError])

    Vitest.expect(result).toBeInstanceOf(BrowserError.UnknownError)

    if (!(result instanceof BrowserError.UnknownError)) {
      throw new Error('Expected an UnknownError instance')
    }

    Vitest.expect(result.description).toBe('pre-parsed')
  })
})
