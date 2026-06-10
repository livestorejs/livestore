export * from 'effect/Scheduler'

import { Scheduler } from 'effect'

// Based on https://github.com/astoilkov/main-thread-scheduling/blob/4b99c26ab96781bc35a331f5c225ad9c8a62cb95/src/utils/waitNextTask.ts#L25
export const messageChannel = () =>
  new Scheduler.MixedScheduler('async', (task) => {
    const messageChannel = new MessageChannel()

    messageChannel.port1.onmessage = task
    messageChannel.port2.postMessage(undefined)

    return () => {
      messageChannel.port1.close()
      messageChannel.port2.close()
    }
  })
