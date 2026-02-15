import { Schema } from '@livestore/livestore'
import * as S2 from '@livestore/sync-s2'
import * as S2Helpers from '@livestore/sync-s2/s2-proxy-helpers'

// Configure S2 connection
const s2Config: S2Helpers.S2Config = {
  basin: process.env.S2_BASIN ?? 'your-basin',
  token: process.env.S2_ACCESS_TOKEN!, // Your S2 access token
}

// HEAD /api/s2 - Health check/ping
export async function HEAD() {
  return new Response(null, { status: 200 })
}

// GET /api/s2 - Pull events
export async function GET(request: Request) {
  const url = new URL(request.url)
  const args = S2.decodePullArgsFromSearchParams(url.searchParams)
  const streamName = S2.makeS2StreamName(args.storeId)

  // Ensure basin and stream exist
  await S2Helpers.ensureBasin(s2Config)
  await S2Helpers.ensureStream(s2Config, streamName)

  // Build request with appropriate headers and URL
  // Note: buildPullRequest handles cursor+1 conversion internally
  const { url: pullUrl, headers } = S2Helpers.buildPullRequest({ config: s2Config, args })

  const res = await fetch(pullUrl, { headers })

  // For live pulls (SSE), proxy the response
  if (args.live === true) {
    if (!res.ok) {
      return S2Helpers.sseKeepAliveResponse()
    }
    return new Response(res.body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  // For regular pulls
  if (!res.ok) {
    return S2Helpers.emptyBatchResponse()
  }

  const batch = await res.text()
  return new Response(batch, {
    headers: { 'content-type': 'application/json' },
  })
}

// POST /api/s2 - Push events
export async function POST(request: Request) {
  const requestBody = await request.json()
  const parsed = Schema.decodeUnknownSync(S2.ApiSchema.PushPayload)(requestBody)
  const streamName = S2.makeS2StreamName(parsed.storeId)

  // Ensure basin and stream exist
  await S2Helpers.ensureBasin(s2Config)
  await S2Helpers.ensureStream(s2Config, streamName)

  // Build push request with proper formatting
  const pushRequests = S2Helpers.buildPushRequests({
    config: s2Config,
    storeId: parsed.storeId,
    batch: parsed.batch,
  })

  for (const pushRequest of pushRequests) {
    const res = await fetch(pushRequest.url, {
      method: 'POST',
      headers: pushRequest.headers,
      body: pushRequest.body,
    })

    if (!res.ok) {
      return S2Helpers.errorResponse('Push failed', 500)
    }
  }

  return S2Helpers.successResponse()
}
