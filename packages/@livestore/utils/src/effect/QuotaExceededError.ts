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
