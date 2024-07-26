export * from 'effect/Scheduler'

import { Scheduler } from 'effect'

// Based on https://github.com/astoilkov/main-thread-scheduling/blob/4b99c26ab96781bc35a331f5c225ad9c8a62cb95/src/utils/waitNextTask.ts#L25
export const messageChannel = (shouldYield: Scheduler.Scheduler['shouldYield'] = Scheduler.defaultShouldYield) =>
  Scheduler.makeBatched((task) => {
    const messageChannel = new MessageChannel()

    messageChannel.port1.postMessage(undefined)

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    messageChannel.port2.onmessage = task
  }, shouldYield)
