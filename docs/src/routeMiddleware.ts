import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import { Schema } from 'effect'

const StarlightLocalsSchema = Schema.Struct({
  starlightRoute: Schema.Struct({
    entry: Schema.Struct({
      slug: Schema.optional(Schema.String),
    }),
    head: Schema.Array(Schema.Unknown),
  }),
})

export const onRequest = defineRouteMiddleware((context) => {
  // console.log('context', context, context.locals.starlightRoute)

  const decodeLocals = Schema.decodeUnknownEither(StarlightLocalsSchema)(context.locals)
  if (decodeLocals._tag === 'Left') return

  const { starlightRoute } = decodeLocals.right

  // Get the URL of the generated image for the current page using its ID and
  // append the `.png` file extension.
  const ogImageUrl = new URL(`/og/${starlightRoute.entry.slug ?? 'index'}.png`, context.site)

  // Get the array of all tags to include in the `<head>` of the current page.
  const { head } = starlightRoute

  // Add the `<meta/>` tags for the Open Graph images.
  head.push(
    {
      tag: 'meta',
      attrs: { property: 'og:image', content: ogImageUrl.href },
    },
    {
      tag: 'meta',
      attrs: { name: 'twitter:image', content: ogImageUrl.href },
    },
  )
})
