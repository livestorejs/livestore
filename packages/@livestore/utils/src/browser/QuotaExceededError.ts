/**
 * Type augmentation for the `QuotaExceededError` interface.
 *
 * In previous versions of the Web platform standard, quota exceeded errors were to be thrown
 * as regular `DOMException` objects with `name: "QuotaExceededError"`. In the latest versions,
 * the `QuotaExceededError` exists as a dedicated interface extending `DOMException`, providing
 * additional properties like `quota` and `requested`.
 *
 * As of TypeScript 5.9, the standard DOM type definitions (`lib.dom.d.ts`) do **not** include
 * the `QuotaExceededError` interface, even though it is already supported by a few browsers.
 *
 * This file provides the missing type definitions so that code can safely reference
 * `globalThis.QuotaExceededError` with proper type checking, supporting both:
 * - Browsers with the new dedicated interface
 * - Browsers still using a regular `DOMException`
 *
 * @see {@link https://webidl.spec.whatwg.org/#quotaexceedederror | Web IDL Specification}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError | MDN Reference}
 */
declare global {
  interface QuotaExceededError extends DOMException {
    /**
     * The **`message`** read-only property of a message or description associated with the given error name.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError/QuotaExceededError#message)
     */
    readonly message: string
    /**
     * A number representing the quota limit in bytes, or undefined.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError/quota)
     */
    readonly quota?: number
    /**
     * A number representing the requested amount of storage in bytes, or undefined.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError/requested)
     */
    readonly requested?: number
  }

  /**
   * The **`QuotaExceededError`** represents an error when a requested operation would exceed a system-imposed storage quota.
   *
   * @remarks
   *
   * In browser versions before this interface was implemented, it was a regular DOMException. The subclassing allows for extra information like quota and requested to be included.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError)
   */
  var QuotaExceededError:
    | {
        prototype: QuotaExceededError
        new (message?: string, options?: { quota: number; requested: number }): QuotaExceededError
      }
    | undefined
}

export {}
