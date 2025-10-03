import { getCollection } from 'astro:content'

/**
 * Dev-only API used by Playwright to discover docs pages.
 *
 * The contextual-menu E2E test samples several docs at random and needs a canonical
 * list of slugs that mirrors the markdown routes we expose (`/slug/index.md`).
 * We keep this handler out of production to avoid leaking internal test helpers.
 */

export const prerender = false

const toSlug = (id: string, slug: string | undefined): string => {
  if (typeof slug === 'string' && slug.trim() !== '') {
    return slug.replace(/^\//, '')
  }

  return id
    .replace(/^docs\//, '')
    .replace(/\.(md|mdx)$/i, '')
    .replace(/\/index$/i, '')
}

export async function GET() {
  if (!import.meta.env.DEV) {
    return new Response('Not found', { status: 404 })
  }

  const docs = await getCollection('docs')
  const slugs = docs.map((doc) => toSlug(doc.id, doc.slug)).filter((slug) => slug !== '')

  return new Response(JSON.stringify({ slugs }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
