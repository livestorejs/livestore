export * from 'effect/Scheduler'

import { Scheduler } from 'effect'

/**
 * Effect v4's `MixedScheduler` already owns batching, priority ordering, and
 * automatic yield decisions. This v3 carryover only swaps the host scheduling
 * primitive from the default worker fallback (`setTimeout(0)`) to
 * `MessageChannel`.
 *
 * TODO: Reconsider whether this custom scheduler is still needed now that v4's
 * default scheduler handles batching directly.
 */
export const messageChannel = (): Scheduler.Scheduler =>
  new Scheduler.MixedScheduler('async', scheduleTaskWithMessageChannel)

const scheduleTaskWithMessageChannel = (task: () => void): (() => void) => {
  if (typeof MessageChannel === 'undefined') {
    const timeout = setTimeout(task, 0)
    return () => clearTimeout(timeout)
  }

  const channel = new MessageChannel()
  let closed = false

  const close = () => {
    if (closed === true) return
    closed = true
    channel.port2.onmessage = null
    channel.port1.close()
    channel.port2.close()
  }

  // Based on https://github.com/astoilkov/main-thread-scheduling/blob/4b99c26ab96781bc35a331f5c225ad9c8a62cb95/src/utils/waitNextTask.ts#L25
  channel.port2.onmessage = () => {
    close()
    task()
  }
  channel.port1.postMessage(undefined)

  return close
}
