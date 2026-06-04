import { Schema } from '@livestore/livestore'
import * as S2 from '@livestore/sync-s2'
import * as S2Helpers from '@livestore/sync-s2/s2-proxy-helpers'
import { Config, Effect, Option } from '@livestore/utils/effect'
import { createFileRoute } from '@tanstack/react-router'

const {
  token: s2Token,
  basin: s2Basin,
  endpoint: s2Endpoint,
} = Effect.runSync(
  Config.all({
    token: Config.string('S2_ACCESS_TOKEN').pipe(Config.withDefault('redundant')),
    basin: Config.string('S2_BASIN').pipe(Config.withDefault('ls-examples')),
    endpoint: Config.option(Config.string('S2_ENDPOINT')),
  }),
)

const s2Config: S2Helpers.S2Config = Option.isSome(s2Endpoint)
  ? {
      basin: s2Basin,
      token: s2Token,
      accountBase: `${s2Endpoint.value}/v1`,
      basinBase: `${s2Endpoint.value}/v1`,
      lite: true,
    }
  : {
      basin: s2Basin,
      token: s2Token,
    }

export const Route = createFileRoute('/api/s2')({
  server: {
    handlers: {
      // Ping
      HEAD: async () => new Response(null, { status: 200 }),
      // Pull
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const args = S2.decodePullArgsFromSearchParams(url.searchParams)
          const streamName = S2.makeS2StreamName(args.storeId)
          await S2Helpers.ensureBasin(s2Config)
          await S2Helpers.ensureStream(s2Config, streamName)

          const pullRequest = S2Helpers.buildPullRequest({ config: s2Config, args })
          const res = await fetch(pullRequest.url, { headers: pullRequest.headers })

          if (!res.ok) {
            console.error('[api/s2] live pull error', await res.text())
            return S2Helpers.sseKeepAliveResponse()
          }
          return new Response(res.body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        } catch (error) {
          console.error('[api/s2] pull error', error)
          return S2Helpers.emptyBatchResponse()
        }
      },
      // Push
      POST: async ({ request }) => {
        try {
          const requestBody = await request.json()
          const { storeId, batch } = Schema.decodeUnknownSync(S2.ApiSchema.PushPayload)(requestBody)
          const streamName = S2.makeS2StreamName(storeId)
          await S2Helpers.ensureBasin(s2Config)
          await S2Helpers.ensureStream(s2Config, streamName)

          const pushRequests = S2Helpers.buildPushRequests({ config: s2Config, storeId, batch })

          for (const pushRequest of pushRequests) {
            const res = await fetch(pushRequest.url, {
              method: 'POST',
              headers: pushRequest.headers,
              body: pushRequest.body,
            })

            if (!res.ok) {
              console.error('[api/s2] push error', res.status, await res.text())
              return S2Helpers.errorResponse('Push failed', 500)
            }
          }

          return S2Helpers.successResponse()
        } catch (error) {
          if (error instanceof S2.S2LimitExceededError) {
            return S2Helpers.errorResponse(
              `S2 limit exceeded (${error.limitType}): actual ${error.actual}, max ${error.max}`,
              413,
            )
          }

          return S2Helpers.errorResponse('Push failed', 500)
        }
      },
    },
  },
})
