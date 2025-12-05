import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'
import { docsSidebar, type TSidebarItem } from '../data/sidebar.ts'

/**
 * Utilities for producing LLMS listings reused across API endpoints, markdown
 * exports, and MDX embeds so they never drift apart.
 *
 * The hierarchical structure is derived from the shared sidebar config in
 * `src/data/sidebar.ts` to ensure consistency with the website navigation.
 */

type TLlmsDoc = CollectionEntry<'docs'>

export type TLlmsEntry = {
  readonly title: string
  readonly description: string
  readonly href: string
  readonly slug: string
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

/** Convert a doc path to a slug (for matching against sidebar config) */
const toSlug = (entry: TLlmsDoc): string => toDocPath(entry)

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
      slug: toSlug(doc),
    }
  })

/** Creates a map from slug to doc entry for fast lookup */
const createDocsMap = (entries: ReadonlyArray<TLlmsEntry>): Map<string, TLlmsEntry> => {
  const map = new Map<string, TLlmsEntry>()
  for (const entry of entries) {
    map.set(entry.slug, entry)
  }
  return map
}

/** Get docs that match a directory prefix, sorted by frontmatter order */
const getDocsForDirectory = (
  directory: string,
  entries: ReadonlyArray<TLlmsEntry>,
  docs: ReadonlyArray<TLlmsDoc>,
): ReadonlyArray<TLlmsEntry> => {
  const normalizedDirectory = directory.endsWith('/') ? directory.slice(0, -1) : directory
  const prefix = `${normalizedDirectory}/`

  // Create a map from slug to original doc for order info
  const docBySlug = new Map<string, TLlmsDoc>()
  for (const doc of docs) {
    docBySlug.set(toSlug(doc), doc)
  }

  return entries
    .filter((entry) => {
      // Include the directory index page (e.g. "getting-started")
      if (entry.slug === normalizedDirectory) return true

      // Match docs in this directory but not nested subdirectories
      if (!entry.slug.startsWith(prefix)) return false
      const remaining = entry.slug.slice(prefix.length)
      // Don't include nested items (they'll be handled by their own autogenerate)
      return !remaining.includes('/')
    })
    .sort((a, b) => {
      const docA = docBySlug.get(a.slug)
      const docB = docBySlug.get(b.slug)
      const orderA = docA?.data.sidebar?.order ?? 999
      const orderB = docB?.data.sidebar?.order ?? 999
      return orderA - orderB
    })
}

type TRenderContext = {
  readonly docsMap: Map<string, TLlmsEntry>
  readonly allEntries: ReadonlyArray<TLlmsEntry>
  readonly docs: ReadonlyArray<TLlmsDoc>
  readonly depth: number
}

const renderDocLink = (entry: TLlmsEntry): string => {
  const suffix = entry.description.length > 0 ? `: ${entry.description}` : ''
  return `- [${entry.title}](${entry.href})${suffix}`
}

/**
 * Recursively renders sidebar items into hierarchical markdown.
 * Groups become headings, links become list items.
 */
const renderSidebarItems = (items: ReadonlyArray<TSidebarItem>, ctx: TRenderContext): string => {
  const lines: string[] = []

  for (const item of items) {
    switch (item._tag) {
      case 'link': {
        const entry = ctx.docsMap.get(item.slug)
        if (entry) {
          lines.push(renderDocLink(entry))
        }
        break
      }

      case 'autoGroup': {
        // Auto-generated group with heading and docs from directory
        const headingLevel = Math.min(ctx.depth + 2, 6)
        const heading = '#'.repeat(headingLevel)
        lines.push('')
        lines.push(`${heading} ${item.label}`)
        lines.push('')

        const dirDocs = getDocsForDirectory(item.directory, ctx.allEntries, ctx.docs)
        for (const entry of dirDocs) {
          lines.push(renderDocLink(entry))
        }
        break
      }

      case 'group': {
        // Group with explicit items
        const headingLevel = Math.min(ctx.depth + 2, 6)
        const heading = '#'.repeat(headingLevel)
        lines.push('')
        lines.push(`${heading} ${item.label}`)
        lines.push('')

        // Render nested items with increased depth
        const nested = renderSidebarItems(item.items, { ...ctx, depth: ctx.depth + 1 })
        if (nested.trim().length > 0) {
          lines.push(nested)
        }
        break
      }
    }
  }

  return lines.join('\n')
}

/**
 * Render the hierarchical docs list following the sidebar structure.
 */
const renderLlmsListHierarchical = ({ docs, site }: TToEntriesOptions): string => {
  const entries = toLlmsEntries({ docs, site })
  const docsMap = createDocsMap(entries)

  const ctx: TRenderContext = {
    docsMap,
    allEntries: entries,
    docs,
    depth: 0,
  }

  return renderSidebarItems(docsSidebar, ctx)
}

/**
 * Render the flat list snippet (legacy format, still used for LlmsShort embeds).
 */
const renderLlmsListFlat = ({ docs, site }: TToEntriesOptions): string =>
  toLlmsEntries({ docs, site })
    .map((entry) => {
      const suffix = entry.description.length > 0 ? `: ${entry.description}` : ''
      return `- [${entry.title}](${entry.href})${suffix}\n`
    })
    .join('')

export const renderLlmsText = ({ docs, site }: TRenderOptions): string => {
  const docsSection = renderLlmsListHierarchical({ docs, site })
  return `# LiveStore Documentation for LLMs

> LiveStore is a client-centric local-first data layer for high-performance apps based on SQLite and event-sourcing.

## Notes

- Most LiveStore APIs are synchronous and don't need \`await\`

${docsSection}
`
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
  const docsSection = renderLlmsListFlat({ docs, site }).trimEnd()
  return markdown.replace(LLMS_SHORT_PATTERN, `${docsSection}\n`)
}

/** Re-export sidebar config for use in docs-export.ts */
export { docsSidebar, type TSidebarItem } from '../data/sidebar.ts'
