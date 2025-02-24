import { runSSR } from '../../src/ssr.js'

export default async (req: Request) => {
  // NOTE we need to do the URL resolving here because Netlify's bundler isn't ideal yet
  const dbUrl = new URL('../../dist/app-123.db', import.meta.url)
  const indexHtmlUrl = new URL('../../dist/index2.html', import.meta.url)
  const html = await runSSR({ dbUrl, indexHtmlUrl, isNetlify: true })
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}
