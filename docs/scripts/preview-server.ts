import { stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildMarkdownRelativePath, isAssetPath, preferredMarkdown } from '../src/server/markdown-negotiation.ts'

/**
 * Netlify Dev only runs edge functions when it proxies to a user-provided
 * origin. The Netlify adapter also disables `astro preview`
 * (https://github.com/withastro/astro/issues/13180), so we spin up this tiny
 * Bun server to serve `dist/` with the right markdown MIME type. That lets the
 * edge handler run locally during `mono docs preview`, mirroring production.
 */

interface PreviewOptions {
  readonly port: number | undefined
  readonly host: string | undefined
}

const parseArgs = (argv: string[]): PreviewOptions => {
  let port: number | undefined
  let host: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) continue

    if (arg === '--port' || arg === '-p') {
      const value = argv[index + 1]
      if (value !== undefined) {
        port = Number.parseInt(value, 10)
        index += 1
      }
      continue
    }
    if (arg.startsWith('--port=')) {
      port = Number.parseInt(arg.split('=')[1] ?? '', 10)
      continue
    }

    if (arg === '--host') {
      host = argv[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--host=')) {
      host = arg.split('=')[1]
    }
  }

  return { port: Number.isNaN(port ?? Number.NaN) ? undefined : port, host }
}

const ensureWithinDist = (distDir: string, relativePath: string): string | undefined => {
  const normalized = normalize(relativePath)
  const absolutePath = join(distDir, normalized)
  if (!absolutePath.startsWith(distDir)) {
    return undefined
  }
  return absolutePath
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const stats = await stat(path)
    return stats.isFile()
  } catch (_error) {
    return false
  }
}

const directoryExists = async (path: string): Promise<boolean> => {
  try {
    const stats = await stat(path)
    return stats.isDirectory()
  } catch (_error) {
    return false
  }
}

const resolveStaticRelative = async (distDir: string, pathname: string): Promise<string | undefined> => {
  const decoded = decodeURIComponent(pathname)
  const stripped = decoded.replace(/^\/+/, '')
  const candidates = new Set<string>()

  if (stripped === '') {
    candidates.add('index.html')
  } else {
    candidates.add(stripped)
    if (stripped.endsWith('/')) {
      candidates.add(`${stripped}index.html`)
    } else {
      const withIndex = `${stripped}/index.html`
      const withHtml = stripped.endsWith('.html') ? stripped : `${stripped}.html`
      candidates.add(withIndex)
      candidates.add(withHtml)
    }
  }

  for (const candidate of candidates) {
    const absolutePath = ensureWithinDist(distDir, candidate)
    if (absolutePath !== undefined && (await fileExists(absolutePath))) {
      return candidate
    }
  }
  return undefined
}

const createMarkdownResponse = async (
  distDir: string,
  url: URL,
  isHeadRequest: boolean,
): Promise<Response | undefined> => {
  const relativeMarkdownPath = buildMarkdownRelativePath(url)
  const absolutePath = ensureWithinDist(distDir, relativeMarkdownPath)
  if (absolutePath === undefined) {
    return undefined
  }
  if (!(await fileExists(absolutePath))) {
    return undefined
  }

  const headers = new Headers({
    'Content-Type': 'text/markdown; charset=utf-8',
    Vary: 'Accept',
  })
  return isHeadRequest
    ? new Response(null, { status: 200, headers })
    : new Response(Bun.file(absolutePath), { status: 200, headers })
}

const createStaticResponse = async (
  distDir: string,
  relativePath: string,
  isHeadRequest: boolean,
): Promise<Response | undefined> => {
  const absolutePath = ensureWithinDist(distDir, relativePath)
  if (absolutePath === undefined) {
    return undefined
  }
  if (!(await fileExists(absolutePath))) {
    return undefined
  }

  const file = Bun.file(absolutePath)
  const headers = new Headers()
  if (file.type) {
    headers.set('Content-Type', file.type)
  }

  return isHeadRequest ? new Response(null, { status: 200, headers }) : new Response(file, { status: 200, headers })
}

const docsRoot = fileURLToPath(new URL('..', import.meta.url))

const startServer = async (): Promise<void> => {
  const args = parseArgs(Bun.argv.slice(2))
  const distDir = join(docsRoot, 'dist')
  if (!(await directoryExists(distDir))) {
    console.error('Docs dist folder not found. Run `mono docs build` first or pass `--build` to the preview command.')
    process.exit(1)
  }

  const port = args.port ?? Number.parseInt(Bun.env.PORT ?? '8888', 10)
  const host = args.host ?? '127.0.0.1'

  const server = Bun.serve({
    port,
    hostname: host,
    fetch: async (request) => {
      try {
        const method = request.method.toUpperCase()
        const isHeadRequest = method === 'HEAD'
        if (method !== 'GET' && !isHeadRequest) {
          return new Response('Method Not Allowed', { status: 405 })
        }

        const url = new URL(request.url)
        if (!isAssetPath(url.pathname) && preferredMarkdown(request.headers.get('Accept'))) {
          const markdownResponse = await createMarkdownResponse(distDir, url, isHeadRequest)
          if (markdownResponse) {
            return markdownResponse
          }
        }

        const staticPath = await resolveStaticRelative(distDir, url.pathname)
        if (staticPath) {
          const staticResponse = await createStaticResponse(distDir, staticPath, isHeadRequest)
          if (staticResponse) {
            return staticResponse
          }
        }

        return new Response('Not Found', { status: 404 })
      } catch (error) {
        console.error('Preview server encountered an unexpected error:', error)
        return new Response('Internal Server Error', { status: 500 })
      }
    },
  })

  const resolvedHost = server.hostname ?? host
  const previewUrl = `http://${resolvedHost}:${server.port}`
  console.log(`Docs preview running at ${previewUrl}`)
  console.log('Press Ctrl+C to stop the server.')

  await server.closed
}

await startServer()
