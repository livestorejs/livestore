import Mixedbread from '@mixedbread/sdk'
import type { APIRoute } from 'astro'
import Slugger from 'github-slugger'
import removeMd from 'remove-markdown'

export const prerender = false

const mxbai = new Mixedbread({
  apiKey: import.meta.env.MXBAI_API_KEY,
})

const slugger = new Slugger()

interface SearchMetadata {
  title?: string
  description?: string
  path?: string
  file_path?: string
}

export interface SearchResult {
  id: string
  type: 'page' | 'heading'
  title: string
  description: string
  url: string
}

function filePathToHref(filePath: string): string {
  // Extract the path after /src/content/docs/
  const match = filePath.match(/\/src\/content\/docs\/(.+)$/)
  if (!match) return '/'
  let href = match[1]
  href = href.replace(/\.(md|mdx)$/, '')
  href = href.replace(/\/index$/, '')
  return `/${href}`
}

function extractHeadingTitle(text: string): string {
  const trimmedText = text.trim()

  if (!trimmedText.startsWith('#')) {
    return ''
  }

  const lines = trimmedText.split('\n')
  const firstLine = lines[0]?.trim()

  if (firstLine) {
    // Use remove-markdown to convert to plain text
    const plainText = removeMd(firstLine, {
      useImgAltText: false,
    })

    return plainText
  }

  return ''
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

    const seenFiles = new Set<string>()
    const results: SearchResult[] = []

    response.data.forEach((item, index) => {
      const metadata = {
        ...(item.metadata ?? {}),
        ...(item.generated_metadata ?? {}),
      } as SearchMetadata

      const url = filePathToHref(metadata?.file_path || '')
      const title = metadata?.title || 'Untitled'
      const description = metadata?.description || ''

      if (!seenFiles.has(url)) {
        seenFiles.add(url)
        results.push({
          id: `${item.file_id}-${index}-page`,
          type: 'page',
          title,
          description,
          url,
        })
      }

      const headingTitle = item.type === 'text' ? extractHeadingTitle(item.text) : undefined

      if (headingTitle && item.type === 'text') {
        slugger.reset()
        results.push({
          id: `${item.file_id}-${index}-heading`,
          type: 'heading',
          title: headingTitle,
          description: removeMd(item.text.substring(0, 200)).replace(headingTitle, '').trim(),
          url: `${url}#${slugger.slug(headingTitle)}`,
        })
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
