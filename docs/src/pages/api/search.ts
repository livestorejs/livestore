import Mixedbread from '@mixedbread/sdk'
import type { APIRoute } from 'astro'

export const prerender = false

const mxbai = new Mixedbread({
  apiKey: import.meta.env.MXBAI_API_KEY,
})

interface SearchMetadata {
  title?: string
  description?: string
  path?: string
  file_path?: string
}

function filePathToHref(filePath: string): string {
  // Extract the path after /src/content/docs/
  const match = filePath.match(/\/src\/content\/docs\/(.+)$/)
  if (!match) return '/'
  let href = match[1]
  href = href.replace(/\.(md|mdx)$/, '')
  href = href.replace(/\/index$/, '')
  return `/${href || ''}`
}

export const GET: APIRoute = async ({ url }) => {
  if (!import.meta.env.MXBAI_API_KEY || !import.meta.env.VECTOR_STORE_ID) {
    return new Response(JSON.stringify({ error: 'Mixedbread Search API is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const query = url.searchParams.get('query')!

  if (!query) {
    return new Response(JSON.stringify({ error: 'Query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const response = await mxbai.vectorStores.search({
      query,
      vector_store_identifiers: [import.meta.env.VECTOR_STORE_ID],
      top_k: 10,
      search_options: {
        return_metadata: true,
      },
    })

    const results = response.data.map((item, index) => {
      const metadata = {
        ...(item.metadata ?? {}),
        ...(item.generated_metadata ?? {}),
      } as SearchMetadata

      return {
        id: `${item.file_id}-${index}`,
        title: metadata?.title || 'Untitled',
        description: metadata?.description || '',
        content: (item as unknown as { text: string }).text || '',
        path: metadata?.file_path || '',
        href: filePathToHref(metadata?.file_path || ''),
        score: item.score || 0,
      }
    })

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Search error:', error)
    return new Response(JSON.stringify({ error: 'Something went wrong' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
