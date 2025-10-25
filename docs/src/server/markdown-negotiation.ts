export type MediaRange = {
  type: string
  subtype: string
  q: number
  order: number
}

export const isAssetPath = (pathname: string): boolean =>
  pathname.startsWith('/_astro') ||
  pathname.startsWith('/_image') ||
  pathname.startsWith('/api/') ||
  /\.[A-Za-z0-9]+$/.test(pathname)

export const parseAcceptHeader = (value: string | null): MediaRange[] => {
  if (!value) return []
  const parts = value.split(',')
  const ranges: MediaRange[] = []
  parts.forEach((part, index) => {
    const trimmed = part.trim()
    if (trimmed.length === 0) return

    const [typePart, ...paramParts] = trimmed.split(';').map((segment) => segment.trim())
    if (typePart === undefined || typePart.length === 0) return

    const [rawType, rawSubtype] = typePart.split('/')
    if (!rawType || !rawSubtype) return

    const type = rawType.trim()
    const subtype = rawSubtype.trim()
    if (type.length === 0 || subtype.length === 0) return

    let q = 1
    for (const param of paramParts) {
      const [key, rawValue] = param.split('=').map((segment) => segment.trim())
      if (key !== undefined && rawValue !== undefined && key.toLowerCase() === 'q') {
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

export const scoreForMediaType = (
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

export const preferredMarkdown = (accept: string | null): boolean => {
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

const ensureTrailingSlash = (pathname: string): string => (pathname.endsWith('/') ? pathname : `${pathname}/`)

export const buildMarkdownUrl = (url: URL): string => {
  const pathname = ensureTrailingSlash(url.pathname)
  return `${url.origin}${pathname}index.md${url.search}`
}

export const buildMarkdownRelativePath = (url: URL): string => {
  const pathname = ensureTrailingSlash(url.pathname)
  const relativePath = `${pathname.slice(1)}index.md`
  return relativePath.replace(/^\/+/, '')
}

export const appendVary = (response: Response, headerValue: string): void => {
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
