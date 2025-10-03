import type { Context } from 'netlify:edge'

/** Parsed representation of a media range inside an Accept header. */
type MediaRange = {
  type: string
  subtype: string
  q: number
  order: number
}

const isAssetPath = (pathname: string): boolean =>
  pathname.startsWith('/_astro') ||
  pathname.startsWith('/_image') ||
  pathname.startsWith('/api/') ||
  /\.[A-Za-z0-9]+$/.test(pathname)

/**
 * Parses an Accept header into individual media ranges while keeping the
 * original ordering so we can break ties deterministically.
 */
const parseAcceptHeader = (value: string | null): MediaRange[] => {
  if (!value) return []
  const parts = value.split(',')
  const ranges: MediaRange[] = []
  parts.forEach((part, index) => {
    const trimmed = part.trim()
    if (trimmed.length === 0) return

    const [typePart, ...paramParts] = trimmed.split(';').map((segment) => segment.trim())
    const [type, subtype] = typePart.split('/')
    if (!type || !subtype) return

    let q = 1
    for (const param of paramParts) {
      const [key, rawValue] = param.split('=').map((segment) => segment.trim())
      if (key.toLowerCase() === 'q') {
        const parsed = Number.parseFloat(rawValue)
        if (!Number.isNaN(parsed)) {
          q = parsed
        }
      }
    }

    ranges.push({
      type: type.toLowerCase(),
      subtype: subtype.toLowerCase(),
      q: Math.max(Math.min(q, 1), 0),
      order: index,
    })
  })
  return ranges
}

const matchesRange = (range: MediaRange, type: string, subtype: string): number | null => {
  if (range.q === 0) return null

  if (range.type === '*' && range.subtype === '*') {
    return 0
  }
  if (range.type === type && range.subtype === '*') {
    return 1
  }
  if (range.type === type && range.subtype === subtype) {
    return 2
  }
  return null
}

/**
 * Computes the best match for a target media type given a parsed Accept list.
 * Higher `specificity` reflects an exact match over wildcards; ties fall back
 * to the highest quality (`q`) and finally the earliest match in the header.
 */
const scoreForMediaType = (
  ranges: MediaRange[],
  type: string,
  subtype: string,
): { q: number; specificity: number; order: number } => {
  let best = { q: 0, specificity: -1, order: Number.POSITIVE_INFINITY }
  ranges.forEach((range) => {
    const specificity = matchesRange(range, type, subtype)
    if (specificity === null) return

    if (
      specificity > best.specificity ||
      (specificity === best.specificity && range.q > best.q) ||
      (specificity === best.specificity && range.q === best.q && range.order < best.order)
    ) {
      best = { q: range.q, specificity, order: range.order }
    }
  })
  return best
}

/**
 * Returns true when the client explicitly allows Markdown (or a matching
 * wildcard) and does not prefer HTML over it.
 */
const preferredMarkdown = (accept: string | null): boolean => {
  if (!accept) {
    return true
  }

  const ranges = parseAcceptHeader(accept)
  if (ranges.length === 0) {
    return true
  }

  const explicitlyAllowsHtml = ranges.some((range) => range.q > 0 && range.type === 'text' && range.subtype === 'html')
  if (explicitlyAllowsHtml) {
    return false
  }

  const markdownQuality = scoreForMediaType(ranges, 'text', 'markdown')
  const altMarkdownQuality = scoreForMediaType(ranges, 'text', 'x-markdown')
  const appMarkdownQuality = scoreForMediaType(ranges, 'application', 'markdown')

  return markdownQuality.q > 0 || altMarkdownQuality.q > 0 || appMarkdownQuality.q > 0
}

/**
 * Appends `index.md` to the current path so the markdown route mirrors the
 * contextual menu URLs we already generate.
 */
const buildMarkdownUrl = (url: URL): string => {
  let pathname = url.pathname
  if (!pathname.endsWith('/')) {
    pathname = `${pathname}/`
  }
  return `${url.origin}${pathname}index.md${url.search}`
}

/**
 * Ensure we always expose `Vary: Accept` without duplicating values so caches
 * keep HTML and Markdown payloads separated.
 */
const appendVary = (response: Response, headerValue: string): void => {
  const vary = response.headers.get('Vary')
  if (!vary) {
    response.headers.set('Vary', headerValue)
    return
  }

  const values = new Set(
    vary
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  values.add(headerValue)
  response.headers.set('Vary', Array.from(values).join(', '))
}

export default async function handler(request: Request, context: Context): Promise<Response> {
  const method = request.method.toUpperCase()
  const isHeadRequest = method === 'HEAD'

  if (method !== 'GET' && !isHeadRequest) {
    return context.next()
  }

  const url = new URL(request.url)
  if (isAssetPath(url.pathname)) {
    return context.next()
  }

  if (!preferredMarkdown(request.headers.get('Accept'))) {
    return context.next()
  }

  const markdownUrl = buildMarkdownUrl(url)
  const markdownRequest = new Request(markdownUrl, {
    method: 'GET',
    headers: new Headers(request.headers),
  })

  const markdownResponse = await fetch(markdownRequest)
  if (!markdownResponse.ok) {
    return context.next()
  }

  const headers = new Headers(markdownResponse.headers)
  headers.set('Content-Type', 'text/markdown; charset=utf-8')
  const response = isHeadRequest
    ? new Response(null, { status: markdownResponse.status, headers })
    : new Response(markdownResponse.body, { status: markdownResponse.status, headers })
  appendVary(response, 'Accept')
  return response
}
