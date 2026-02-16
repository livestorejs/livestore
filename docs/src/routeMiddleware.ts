import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

export const onRequest = defineRouteMiddleware((context) => {
  // console.log('context', context, context.locals.starlightRoute)

  // Get the URL of the generated image for the current page using its ID and
  // append the `.png` file extension.
  const ogImageUrl = new URL(`/og/${(context.locals as any).starlightRoute.entry.slug || 'index'}.png`, context.site)

  // Get the array of all tags to include in the `<head>` of the current page.
  const { head } = (context.locals as any).starlightRoute

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
