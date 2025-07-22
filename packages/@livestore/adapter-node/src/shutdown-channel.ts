import { ShutdownChannel } from '@livestore/common/leader-thread'
import type { Effect, Scope } from '@livestore/utils/effect'
import { makeBroadcastChannel } from './webchannel.ts'

export const makeShutdownChannel = (
  storeId: string,
): Effect.Effect<ShutdownChannel.ShutdownChannel, never, Scope.Scope> =>
  makeBroadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: ShutdownChannel.All,
  })
