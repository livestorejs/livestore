// https://hideoo.dev/notes/starlight-og-images/

import { OGImageRoute } from 'astro-og-canvas'
import { getCollection } from 'astro:content'

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

// astro-og-canvas >=0.10 made `OGImageRoute` async; it now returns a Promise.
const ogRoute = await OGImageRoute({
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

export const prerender = true

// Astro 6 requires `getStaticPaths` to be a statically-detectable export on dynamic routes.
// Keep it a plain function declaration and gate OG generation inside it via `ogEnabled`.
export const getStaticPaths: typeof ogRoute.getStaticPaths = (context) =>
  ogEnabled === true ? ogRoute.getStaticPaths(context) : []

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

export const GET: typeof ogRoute.GET =
  ogEnabled === true
    ? async (context) => enqueue(async () => ogRoute.GET(context))
    : async () => new Response('OG image generation disabled', { status: 204 })
