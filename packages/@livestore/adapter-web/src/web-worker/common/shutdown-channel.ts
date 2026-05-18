import { ShutdownChannel } from '@livestore/common/leader-thread'
import type { Effect, Scope, WebChannel } from '@livestore/utils/effect'
import { WebChannelBrowser } from '@livestore/utils/effect/browser'

export const makeShutdownChannel = (
  storeId: string,
): Effect.Effect<
  WebChannel.WebChannel<typeof ShutdownChannel.All.Type, typeof ShutdownChannel.All.Type>,
  never,
  Scope.Scope
> =>
  WebChannelBrowser.broadcastChannel({
    channelName: `livestore.shutdown.${storeId}`,
    schema: ShutdownChannel.All,
  })
