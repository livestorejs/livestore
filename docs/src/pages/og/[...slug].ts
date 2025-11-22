// https://hideoo.dev/notes/starlight-og-images/

import { getCollection } from 'astro:content'
import { OGImageRoute } from 'astro-og-canvas'

const ogEnabled = process.env.LS_SKIP_OG_IMAGES !== '1'

// Get all entries from the `docs` content collection.
const docs = await getCollection(
  'docs',
  (entry) =>
    // For now we're excluding the generated API docs
    !entry.id.includes('api/'),
)

// Map the entry array to an object with the page ID as key and the
// frontmatter data as value.
const pages = Object.fromEntries(docs.map(({ data, id }) => [id, { data }]))

const ogRoute = OGImageRoute({
  pages,
  param: 'slug',
  getImageOptions: (_id: string, page: (typeof pages)[string]) => ({
    title: page.data.title,
    description: page.data.description ?? '',
    bgGradient: [[24, 24, 27]],
    border: { color: [63, 63, 70], width: 20 },
    padding: 60,
    logo: { path: './src/logo.png', size: [180] },
  }),
})

export const prerender = ogEnabled

export const getStaticPaths = ogEnabled ? ogRoute.getStaticPaths : () => []

let generationQueue: Promise<void> = Promise.resolve()

/** Serialise OG rendering to prevent CanvasKit FontMgr crashes under load. */
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = generationQueue.then(task, task)
  generationQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export const GET: typeof ogRoute.GET = ogEnabled
  ? async (context) => enqueue(async () => ogRoute.GET(context))
  : async () => new Response('OG image generation disabled', { status: 204 })
