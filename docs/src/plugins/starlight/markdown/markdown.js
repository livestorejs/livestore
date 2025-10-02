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

import { getCollection, getEntry } from 'astro:content'
import { transformMultiCodeDocument } from '../../../utils/multi-code-markdown.js'

const normalizeDocPath = (p) => {
  if (!p) return 'index'
  let pathValue = String(p)
  pathValue = pathValue.replace(/^docs\//, '')
  pathValue = pathValue.replace(/\/index$/, '')
  pathValue = pathValue.replace(/\.(md|mdx)$/i, '')
  return pathValue === '' ? 'index' : pathValue
}

const staticPathFromDoc = (doc) => {
  const slug = typeof doc.slug === 'string' ? doc.slug.replace(/^\//, '') : undefined
  return slug && slug !== '' ? slug : normalizeDocPath(doc.id)
}

const transformBody = async (doc) =>
  transformMultiCodeDocument({
    id: doc.id,
    collection: doc.collection,
    body: doc.body,
    debug: process.env.LS_DEBUG_MARKDOWN === '1',
  })

export async function GET({ params }) {
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
      } catch (_) {}
    }
  }

  if (!doc) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  const title = doc.data?.title ?? doc.slug ?? key
  const transformedBody = await transformBody(doc)
  const markdown = `# ${title}\n\n${transformedBody}`

  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
    },
  })
}

export async function getStaticPaths() {
  const docs = await getCollection('docs')
  const paths = docs
    .map((doc) => staticPathFromDoc(doc))
    .filter((p) => p !== 'index')
    .map((p) => ({ params: { path: p } }))

  return paths
}
