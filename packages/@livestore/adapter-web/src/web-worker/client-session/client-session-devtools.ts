import type { ClientSession } from '@livestore/common'
import { isDevEnv } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

export const logDevtoolsUrl = ({ clientSession, storeId }: { clientSession: ClientSession; storeId: string }) =>
  Effect.gen(function* () {
    if (isDevEnv()) {
      const searchParams = new URLSearchParams()
      searchParams.set('clientId', clientSession.clientId)
      searchParams.set('sessionId', clientSession.sessionId)
      searchParams.set('storeId', storeId)
      const url = `${location.origin}/_livestore?${searchParams.toString()}`

      // Check whether devtools are available and then log the URL
      const response = yield* Effect.promise(() => fetch(url))
      if (response.ok) {
        const text = yield* Effect.promise(() => response.text())
        if (text.includes('<meta name="livestore-devtools" content="true" />')) {
          // NOTE the trailing `&` is intentional to avoid Chrome opening the URL in the sources pane
          // as the browser already fetched it
          yield* Effect.log(`[@livestore/adapter-web] Devtools ready on ${url}&`)
        }
      }
    }
  }).pipe(Effect.withSpan('@livestore/adapter-web:client-session:devtools:logDevtoolsUrl'))
