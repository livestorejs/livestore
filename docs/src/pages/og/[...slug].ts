// https://hideoo.dev/notes/starlight-og-images/

import { getCollection } from 'astro:content'
import { OGImageRoute } from 'astro-og-canvas'

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

export const { getStaticPaths, GET } = OGImageRoute({
  // Pass down the documentation pages.
  pages,
  // Define the name of the parameter used in the endpoint path, here `slug`
  // as the file is named `[...slug].ts`.
  param: 'slug',
  // Define a function called for each page to customize the generated image.
  getImageOptions: (_id: string, page: (typeof pages)[string]) => {
    return {
      // Use the page title and description as the image title and description.
      title: page.data.title,
      description: page.data.description,
      // Customize various colors and add a border.
      bgGradient: [[24, 24, 27]],
      border: { color: [63, 63, 70], width: 20 },
      padding: 60,
      logo: { path: './src/logo.png', size: [180] },
    }
  },
})
