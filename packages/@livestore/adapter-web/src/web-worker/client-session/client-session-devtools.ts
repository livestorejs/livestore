import type { ClientSession } from '@livestore/common'
import { isDevEnv } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'

export const logDevtoolsUrl = ({ clientSession, storeId }: { clientSession: ClientSession; storeId: string }) =>
  Effect.gen(function* () {
    if (isDevEnv()) {
      const devtoolsPath = globalThis.LIVESTORE_DEVTOOLS_PATH ?? `/_livestore`
      const devtoolsBaseUrl = `${location.origin}${devtoolsPath}`

      // Check whether devtools are available and then log the URL
      const response = yield* Effect.promise(() => fetch(devtoolsBaseUrl))
      if (response.ok) {
        const text = yield* Effect.promise(() => response.text())
        if (text.includes('<meta name="livestore-devtools" content="true" />')) {
          const url = `${devtoolsBaseUrl}/web/${storeId}/${clientSession.clientId}/${clientSession.sessionId}`
          yield* Effect.log(`[@livestore/adapter-web] Devtools ready on ${url}`)
        }
      }
    }
  }).pipe(Effect.withSpan('@livestore/adapter-web:client-session:devtools:logDevtoolsUrl'))
