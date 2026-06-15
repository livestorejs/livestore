export * from 'effect/Scheduler'

import { Scheduler } from 'effect'

// Based on https://github.com/astoilkov/main-thread-scheduling/blob/4b99c26ab96781bc35a331f5c225ad9c8a62cb95/src/utils/waitNextTask.ts#L25
export const messageChannel = (shouldYield?: Scheduler.Scheduler['shouldYield']): Scheduler.Scheduler => {
  const scheduler = new Scheduler.MixedScheduler('async', (task) => {
    const channel = new MessageChannel()

    channel.port1.postMessage(undefined)
    channel.port2.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      task()
    }

    return () => {
      channel.port1.close()
      channel.port2.close()
    }
  })

  if (shouldYield === undefined) {
    return scheduler
  }

  return {
    executionMode: scheduler.executionMode,
    shouldYield,
    makeDispatcher: () => scheduler.makeDispatcher(),
  }
}
