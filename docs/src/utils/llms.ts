import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'

/**
 * Utilities for producing LLMS listings reused across API endpoints, markdown
 * exports, and MDX embeds so they never drift apart.
 */

type TLlmsDoc = CollectionEntry<'docs'>

type TLlmsEntry = {
  readonly title: string
  readonly description: string
  readonly href: string
}

type TRenderOptions = {
  readonly docs: ReadonlyArray<TLlmsDoc>
  readonly site: URL | string | null
}

type TToEntriesOptions = {
  readonly docs: ReadonlyArray<TLlmsDoc>
  readonly site: URL | string | null
}

type TReplaceOptions = {
  readonly markdown: string
  readonly docs: ReadonlyArray<TLlmsDoc>
  readonly site: URL | string | null
}

const isApiDoc = (entry: TLlmsDoc): boolean => entry.id.includes('api/')

const resolveHref = (path: string, site: URL | string | null | undefined): string => {
  if (site instanceof URL) {
    return new URL(path, site).href
  }

  if (typeof site === 'string' && site.length > 0) {
    try {
      return new URL(path, site).href
    } catch (_error) {
      // fall through to relative fallback
    }
  }

  return path.length === 0 ? '/' : `/${path}`
}

const toDocPath = (entry: TLlmsDoc): string => entry.id.replace(/\.(md|mdx)$/u, '').replace(/\/index$/u, '')

export const loadLlmsDocs = async (): Promise<ReadonlyArray<TLlmsDoc>> =>
  getCollection('docs', (entry) => !isApiDoc(entry))

export const toLlmsEntries = ({ docs, site }: TToEntriesOptions): ReadonlyArray<TLlmsEntry> =>
  docs.map((doc) => {
    const path = toDocPath(doc)
    const href = resolveHref(path, site)
    return {
      title: doc.data.title,
      description: doc.data.description ?? '',
      href,
    }
  })

/**
 * Render the short list snippet shared between llms.txt, MDX embeds, and the
 * markdown fallback route.
 */
const renderLlmsList = ({ docs, site }: TToEntriesOptions): string =>
  toLlmsEntries({ docs, site })
    .map((entry) => {
      const suffix = entry.description.length > 0 ? `: ${entry.description}` : ''
      return `- [${entry.title}](${entry.href}/)${suffix}\n`
    })
    .join('')

export const renderLlmsText = ({ docs, site }: TRenderOptions): string => {
  const docsSection = renderLlmsList({ docs, site })
  return `# LiveStore Documentation for LLMs\n\n> LiveStore is a client-centric local-first data layer for high-performance apps based on SQLite and event-sourcing.\n\n## Notes\n\n- Most LiveStore APIs are synchronous and don't need \`await\`\n\n## Docs\n\n${docsSection}\n`
}

const LLMS_SHORT_PATTERN = /<LlmsShort[^>]*\/>/g

export const replaceLlmsShortPlaceholders = ({ markdown, docs, site }: TReplaceOptions): string => {
  if (!markdown.includes('<LlmsShort')) {
    return markdown
  }

  /**
   * Populate the inline list so consumers fetching `/index.md` (LLMs, curl) see
   * the same links as the rendered MDX page.
   */
  const docsSection = renderLlmsList({ docs, site }).trimEnd()
  return markdown.replace(LLMS_SHORT_PATTERN, `${docsSection}\n`)
}
