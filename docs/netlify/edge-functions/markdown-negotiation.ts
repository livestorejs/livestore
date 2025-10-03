import type { Context } from 'netlify:edge'

import { appendVary, buildMarkdownUrl, isAssetPath, preferredMarkdown } from '../../src/server/markdown-negotiation.ts'

/**
 * Netlify caches edge responses aggressively. Even when we fall back to the
 * upstream HTML we still want downstream caches to respect the `Accept`
 * negotiation, so every exit path adds `Vary: Accept` before returning.
 */

export default async function handler(request: Request, context: Context): Promise<Response> {
  const method = request.method.toUpperCase()
  const isHeadRequest = method === 'HEAD'

  if (method !== 'GET' && !isHeadRequest) {
    return context.next()
  }

  const url = new URL(request.url)
  const forwardWithVary = async (): Promise<Response> => {
    // `context.next()` can return reused headers; clone them so `appendVary`
    // can mutate safely without side-effects on the cached upstream response.
    const nextResponse = await context.next()
    const headers = new Headers(nextResponse.headers)
    const response = new Response(nextResponse.body, {
      status: nextResponse.status,
      statusText: nextResponse.statusText,
      headers,
    })
    appendVary(response, 'Accept')
    return response
  }

  if (isAssetPath(url.pathname)) {
    return forwardWithVary()
  }

  if (!preferredMarkdown(request.headers.get('Accept'))) {
    return forwardWithVary()
  }

  const markdownUrl = buildMarkdownUrl(url)
  const markdownRequest = new Request(markdownUrl, {
    method: 'GET',
    headers: new Headers(request.headers),
  })

  const markdownResponse = await fetch(markdownRequest)
  if (!markdownResponse.ok) {
    return forwardWithVary()
  }

  const headers = new Headers(markdownResponse.headers)
  headers.set('Content-Type', 'text/markdown; charset=utf-8')
  const response = isHeadRequest
    ? new Response(null, { status: markdownResponse.status, headers })
    : new Response(markdownResponse.body, { status: markdownResponse.status, headers })
  appendVary(response, 'Accept')
  return response
}
