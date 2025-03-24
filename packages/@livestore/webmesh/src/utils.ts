/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { Duration, Effect } from '@livestore/utils/effect'

/**
 * A set of values that expire after a given timeout
 * The timeout cleanup is performed in a batched way to avoid excessive setTimeout calls
 */
export class TimeoutSet<V> {
  private values = new Map<V, number>()
  private timeoutHandle: NodeJS.Timeout | undefined
  private readonly timeoutMs: number

  private constructor({ timeout }: { timeout: Duration.DurationInput }) {
    this.timeoutMs = Duration.toMillis(timeout)
  }

  static make = (timeout: Duration.DurationInput) =>
    Effect.gen(function* () {
      const timeoutSet = new TimeoutSet({ timeout })

      yield* Effect.addFinalizer(() => Effect.sync(() => timeoutSet.onShutdown()))

      return timeoutSet
    })

  add(value: V): void {
    this.values.set(value, Date.now())
    this.scheduleCleanup()
  }

  has(value: V): boolean {
    return this.values.has(value)
  }

  delete(value: V): void {
    this.values.delete(value)
  }

  private scheduleCleanup(): void {
    if (this.timeoutHandle === undefined) {
      this.timeoutHandle = setTimeout(() => {
        this.cleanup()
        this.timeoutHandle = undefined
      }, this.timeoutMs)
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [value, timestamp] of this.values.entries()) {
      if (now - timestamp >= this.timeoutMs) {
        this.values.delete(value)
      }
    }
  }

  onShutdown = () => clearTimeout(this.timeoutHandle)
}
