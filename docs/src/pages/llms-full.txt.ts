import { getCollection } from 'astro:content'
import type { APIRoute } from 'astro'
import { transformMultiCodeDocument } from '../utils/multi-code-markdown.js'

const docs = await getCollection(
  'docs',
  (entry) =>
    // For now we're excluding the generated API docs
    !entry.id.includes('api/'),
)

const stripLeadingImports = (body: string): string =>
  body
    .replace(/^\s*import\s+.*$/gm, '')
    .replace(/^\s*export const\s+SNIPPETS[\s\S]*?\n\n/gm, '')
    .replace(/\n{3,}/g, '\n\n')

export const GET: APIRoute = async ({ site }) => {
  const transformedDocs = await Promise.all(
    docs.map(async (doc) => {
      const content = await transformMultiCodeDocument({
        id: doc.id,
        collection: doc.collection,
        body: doc.body,
      })
      return { doc, body: stripLeadingImports(content).trim() }
    }),
  )

  const sections = transformedDocs
    .map(({ doc, body }) => {
      const path = doc.id.replace(/\.(md|mdx)$/, '').replace(/index$/, '')
      const url = new URL(path, site)
      return `# [${doc.data.title}](${url.href}/)\n\n${body}\n\n`
    })
    .join('')

  const dedupedSections = (() => {
    const seen = new Set<string>()
    return sections.replace(/(##+ `[^`]+`\n\n```[^\n]* filename="([^"]+)"[\s\S]*?```)/g, (_match, block, filename) => {
      if (seen.has(filename)) {
        return ''
      }
      seen.add(filename)
      return `${block}\n\n`
    })
  })()
    .replace(/<CardGrid>[\s\S]*?<\/CardGrid>/g, '')
    .replace(/^<[A-Z][^>]*>[^\n]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return new Response(
    `<SYSTEM>This is the full developer documentation for LiveStore.</SYSTEM>

## Notes

- Most LiveStore APIs are synchronous and don't need \`await\`

# Start of LiveStore documentation

${dedupedSections}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
