// Local fixed implementation for starlight-markdown route handler.
// Upstream issue: https://github.com/reynaldichernando/starlight-markdown/issues/1
// Upstream PR: https://github.com/reynaldichernando/starlight-markdown/pull/2
// TODO: Remove this file once the upstream plugin normalizes paths consistently.
import { getCollection, getEntry } from 'astro:content'

const normalizeDocPath = (path) => {
  if (!path) return 'index'
  let p = String(path)
  // Remove collection prefix if present
  p = p.replace(/^docs\//, '')
  // Remove trailing index
  p = p.replace(/\/index$/, '')
  // Remove extension
  p = p.replace(/\.(md|mdx)$/i, '')
  return p === '' ? 'index' : p
}

export async function GET({ params }) {
  const key = normalizeDocPath(params?.path)

  const docs = await getCollection('docs')

  // Try to find a matching entry by comparing normalized paths and slugs
  const findMatch = () => {
    for (const doc of docs) {
      const idNorm = normalizeDocPath(doc.id)
      if (idNorm === key || doc.slug === key) return doc
      // Accept `/foo` mapping to `/foo/index`
      if (idNorm === `${key}/index`) return doc
      if (`${idNorm}/index` === key) return doc
    }
    return undefined
  }

  let doc = findMatch()

  // Fallback to getEntry with common variants
  if (!doc) {
    const candidates = [key, `${key}.mdx`, `${key}.md`, `${key}/index`, `${key}/index.mdx`, `${key}/index.md`]
    for (const c of candidates) {
      try {
        const e = await getEntry('docs', c)
        if (e) {
          doc = e
          break
        }
      } catch (_) {
        // ignore and try next
      }
    }
  }

  // Gracefully handle missing entries (e.g. 404 page requests)
  if (!doc) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  const title = doc.data?.title ?? doc.slug ?? key
  const markdown = `# ${title}\n\n${doc.body}`

  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
    },
  })
}

export async function getStaticPaths() {
  const docs = await getCollection('docs')
  const paths = docs
    .map((doc) => normalizeDocPath(doc.id))
    // Exclude the root index from the dynamic route since we have a dedicated /index.md
    .filter((p) => p !== 'index')
    .map((p) => ({ params: { path: p } }))

  return paths
}
