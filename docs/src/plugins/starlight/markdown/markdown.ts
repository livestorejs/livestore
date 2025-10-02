/**
 * Runtime for the LiveStore markdown routes consumed by the contextual menu.
 *
 * Responsibilities:
 * - expose `/index.md` and `/[...path]/index.md` so copy/view actions can fetch
 *   raw markdown even when the docs page was authored in MDX.
 * - normalise `astro:content` entries to slugs that match the public docs URLs
 *   (the upstream package returns `doc.id` which breaks nested routes).
 *
 * Keep behaviour aligned with the `starlight-markdown` package signature because
 * the contextual menu imports it directly before our Vite aliases apply.
 */

import type { CollectionEntry } from 'astro:content'
import { getCollection, getEntry } from 'astro:content'
import type { APIContext } from 'astro'
import { replaceLlmsShortPlaceholders } from '../../../utils/llms.ts'
import { transformMultiCodeDocument } from '../../../utils/multi-code-markdown.js'

type TDoc = CollectionEntry<'docs'>

const normalizeDocPath = (value: unknown): string => {
  if (!value) return 'index'
  let pathValue = String(value)
  pathValue = pathValue.replace(/^docs\//u, '')
  pathValue = pathValue.replace(/\/index$/u, '')
  pathValue = pathValue.replace(/\.(md|mdx)$/iu, '')
  return pathValue === '' ? 'index' : pathValue
}

const staticPathFromDoc = (doc: TDoc): string => {
  const slug = typeof doc.slug === 'string' ? doc.slug.replace(/^\//u, '') : undefined
  return slug && slug !== '' ? slug : normalizeDocPath(doc.id)
}

const transformBody = async (doc: TDoc): Promise<string> =>
  transformMultiCodeDocument({
    id: doc.id,
    collection: doc.collection,
    body: doc.body,
    debug: process.env.LS_DEBUG_MARKDOWN === '1',
  })

const buildResponse = (markdown: string): Response =>
  new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
    },
  })

export async function GET({ params }: APIContext): Promise<Response> {
  const key = normalizeDocPath(params?.path)

  const docs = await getCollection('docs')

  const findMatch = () => {
    for (const doc of docs) {
      const idNorm = normalizeDocPath(doc.id)
      const slugNorm = staticPathFromDoc(doc)
      if (idNorm === key || doc.slug === key) return doc
      if (idNorm === `${key}/index`) return doc
      if (`${idNorm}/index` === key) return doc
      if (slugNorm === key) return doc
      if (slugNorm === `${key}/index`) return doc
    }
    return undefined
  }

  let doc = findMatch()

  if (!doc) {
    const candidates = [key, `${key}.mdx`, `${key}.md`, `${key}/index`, `${key}/index.mdx`, `${key}/index.md`]
    for (const c of candidates) {
      try {
        const entry = await getEntry('docs', c)
        if (entry) {
          doc = entry
          break
        }
      } catch (_error) {
        // ignore lookup failures and continue probing potential filenames
      }
    }
  }

  if (!doc) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const title = doc.data?.title ?? doc.slug ?? key
  const transformedBody = await transformBody(doc)
  /**
   * Substitute the MDX-only `<LlmsShort />` marker so markdown fetches mirror
   * the rendered homepage for crawlers and CLI tooling.
   */
  const markdownWithLlms = replaceLlmsShortPlaceholders({ markdown: transformedBody, docs, site: null })
  const markdown = `# ${title}\n\n${markdownWithLlms}`

  return buildResponse(markdown)
}

export async function getStaticPaths() {
  const docs = await getCollection('docs')
  const paths = docs
    .map((doc) => staticPathFromDoc(doc))
    .filter((p) => p !== 'index')
    .map((p) => ({ params: { path: p } }))

  return paths
}
