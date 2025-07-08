import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'

const docs = await getCollection(
  'docs',
  (entry) =>
    // For now we're excluding the generated API docs
    !entry.id.includes('api/'),
)

export const GET: APIRoute = async ({ site }) => {
  return new Response(
    `# LiveStore Documentation for LLMs

> LiveStore is a client-centric local-first data layer for high-performance apps based on SQLite and event-sourcing.

## Docs

${docs
  .map((doc) => {
    const path = doc.id.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '')
    const url = new URL(path, site)
    return `- [${doc.data.title}](${url.href}/): ${doc.data.description ?? ''}\n`
  })
  .join('')}

`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
