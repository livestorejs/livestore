/**
 * Helper functions for implementing S2 API proxies.
 * These utilities reduce duplication when building HTTP endpoints that bridge to S2.
 */

import type { LiveStoreEvent } from '@livestore/livestore'
import type { PullArgs } from './api-schema.ts'
import { chunkEventsForS2 } from './limits.ts'
import { makeS2StreamName } from './make-s2-url.ts'

/** Configuration for S2 connections */
export interface S2Config {
  basin: string
  token: string
  /** @default 'https://aws.s2.dev/v1' */
  accountBase?: string
  /** @default 'https://{basin}.b.aws.s2.dev/v1' */
  basinBase?: string
}

// URL construction helpers
export const getBasinUrl = (config: S2Config, path: string): string => {
  const base = config.basinBase ?? `https://${config.basin}.b.aws.s2.dev/v1`
  return `${base}${path}`
}

export const getAccountUrl = (config: S2Config, path: string): string => {
  const base = config.accountBase ?? 'https://aws.s2.dev/v1'
  return `${base}${path}`
}

export const getStreamRecordsUrl = (
  config: S2Config,
  stream: string,
  params?: { seq_num?: number; count?: number; clamp?: boolean; wait?: number },
): string => {
  const base = getBasinUrl(config, `/streams/${encodeURIComponent(stream)}/records`)
  if (!params) return base

  const searchParams = new URLSearchParams()
  /** seq_num - The sequence number to start from. See: https://docs.s2.dev/api#seq_num */
  if (params.seq_num !== undefined) searchParams.append('seq_num', params.seq_num.toString())
  /** count - Maximum number of changes to return. See: https://docs.s2.dev/api#count */
  if (params.count !== undefined) searchParams.append('count', params.count.toString())
  /** clamp - Whether to clamp the response to the requested count. See: https://docs.s2.dev/api#clamp */
  if (params.clamp !== undefined) searchParams.append('clamp', params.clamp.toString())
  /** wait - How long to wait for new records before returning. See: https://docs.s2.dev/api#wait */
  if (params.wait !== undefined) searchParams.append('wait', params.wait.toString())

  return searchParams.toString() ? `${base}?${searchParams}` : base
}

// Header helpers
export const getAuthHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
})

export const getSSEHeaders = (token: string): Record<string, string> => ({
  ...getAuthHeaders(token),
  accept: 'text/event-stream',
  's2-format': 'raw',
})

export const getPushHeaders = (token: string): Record<string, string> => ({
  ...getAuthHeaders(token),
  'content-type': 'application/json',
  's2-format': 'raw',
})

// S2 operation helpers
export const ensureBasin = async (config: S2Config): Promise<void> => {
  try {
    await fetch(getAccountUrl(config, '/basins'), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(config.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ basin: config.basin }),
    })
  } catch {
    // Ignore errors - basin might already exist
  }
}

export const ensureStream = async (config: S2Config, stream: string): Promise<void> => {
  try {
    await fetch(getBasinUrl(config, '/streams'), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(config.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stream }),
    })
  } catch {
    // Ignore errors - stream might already exist
  }
}

// Request construction helpers
export const buildPullRequest = ({
  config,
  args,
}: {
  config: S2Config
  args: PullArgs
}): {
  url: string
  headers: Record<string, string>
} => {
  const streamName = makeS2StreamName(args.storeId)
  // Convert cursor (last seen record) to seq_num (where to start reading)
  // cursor points to last processed record, seq_num needs to be the next record
  const seq_num = args.s2SeqNum === 'from-start' ? 0 : args.s2SeqNum + 1

  if (args.live) {
    const url = getStreamRecordsUrl(config, streamName, { seq_num, clamp: true })
    return { url, headers: getSSEHeaders(config.token) }
  } else {
    // Non-live pulls also stream over SSE. We ask S2 to return immediately when
    // the tail is reached by setting wait=0 which gives us an explicit
    // end-of-stream without requesting an arbitrarily large page size.
    const url = getStreamRecordsUrl(config, streamName, { seq_num, wait: 0, clamp: true })
    return { url, headers: getSSEHeaders(config.token) }
  }
}

export interface S2PushRequest {
  readonly url: string
  readonly method: 'POST'
  readonly headers: Record<string, string>
  readonly body: string
}

/**
 * Builds one or more append requests against S2. The helper applies the
 * documented 1 MiB / 1000-record limits via `chunkEventsForS2`, so callers
 * receive a request per compliant chunk instead of hitting 413 responses at
 * runtime.
 */
export const buildPushRequests = ({
  config,
  storeId,
  batch,
}: {
  config: S2Config
  storeId: string
  batch: readonly LiveStoreEvent.AnyEncodedGlobal[]
}): ReadonlyArray<S2PushRequest> => {
  const streamName = makeS2StreamName(storeId)
  const url = getBasinUrl(config, `/streams/${encodeURIComponent(streamName)}/records`)
  const chunks = chunkEventsForS2(batch)

  return chunks.map((chunk) => ({
    url,
    method: 'POST' as const,
    headers: getPushHeaders(config.token),
    body: JSON.stringify({ records: chunk.records }),
  }))
}

// Response helpers
export const emptyBatchResponse = (): Response => {
  return new Response(JSON.stringify({ records: [] }), {
    headers: { 'content-type': 'application/json' },
  })
}

export const sseKeepAliveResponse = (): Response => {
  return new Response('event: ping\ndata: {}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

export const successResponse = (): Response => {
  const body = { success: true }
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

export const errorResponse = (message: string, status = 500): Response => {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
