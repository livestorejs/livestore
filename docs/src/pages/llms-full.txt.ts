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
    `<SYSTEM>This is the full developer documentation for LiveStore.</SYSTEM>

## Notes

- Most LiveStore APIs are synchronous and don't need \`await\`

# Start of LiveStore documentation

${docs
  .map((doc) => {
    const path = doc.id.replace(/\.(md|mdx)$/, '').replace(/index$/, '')
    const url = new URL(path, site)
    // TODO actually render the docs
    return `# [${doc.data.title}](${url.href}/)\n\n## Overview\n\n${doc.body}\n\n`
  })
  .join('')}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
