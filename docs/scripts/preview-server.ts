import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildMarkdownRelativePath, isAssetPath, preferredMarkdown } from '../src/server/markdown-negotiation.ts'

/**
 * Netlify Dev only runs edge functions when it proxies to a user-provided
 * origin. The Netlify adapter also disables `astro preview`
 * (https://github.com/withastro/astro/issues/13180), so we spin up this tiny
 * Node server to serve `dist/` with the right markdown MIME type. That lets the
 * edge handler run locally during `mono docs preview`, mirroring production.
 */

interface PreviewOptions {
  readonly port: number | undefined
  readonly host: string | undefined
}

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const contentTypeForPath = (path: string): string | undefined => CONTENT_TYPES[extname(path).toLowerCase()]

const parseArgs = (argv: string[]): PreviewOptions => {
  let port: number | undefined
  let host: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg == null) continue

    if (arg === '--port' || arg === '-p') {
      const value = argv[index + 1]
      if (value !== undefined) {
        port = Number.parseInt(value, 10)
        index += 1
      }
      continue
    }
    if (arg.startsWith('--port=') === true) {
      port = Number.parseInt(arg.split('=')[1] ?? '', 10)
      continue
    }

    if (arg === '--host') {
      host = argv[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--host=') === true) {
      host = arg.split('=')[1]
    }
  }

  return { port: Number.isNaN(port ?? Number.NaN) === true ? undefined : port, host }
}

const ensureWithinDist = (distDir: string, relativePath: string): string | undefined => {
  const normalized = normalize(relativePath)
  const absolutePath = join(distDir, normalized)
  if (absolutePath.startsWith(distDir) === false) {
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
    if (stripped.endsWith('/') === true) {
      candidates.add(`${stripped}index.html`)
    } else {
      const withIndex = `${stripped}/index.html`
      const withHtml = stripped.endsWith('.html') === true ? stripped : `${stripped}.html`
      candidates.add(withIndex)
      candidates.add(withHtml)
    }
  }

  for (const candidate of candidates) {
    const absolutePath = ensureWithinDist(distDir, candidate)
    if (absolutePath !== undefined && (await fileExists(absolutePath)) === true) {
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
  if ((await fileExists(absolutePath)) === false) {
    return undefined
  }

  const headers = new Headers({
    'Content-Type': 'text/markdown; charset=utf-8',
    Vary: 'Accept',
  })
  return isHeadRequest === true
    ? new Response(null, { status: 200, headers })
    : new Response(await readFile(absolutePath), { status: 200, headers })
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
  if ((await fileExists(absolutePath)) === false) {
    return undefined
  }

  const headers = new Headers()
  const contentType = contentTypeForPath(absolutePath)
  if (contentType !== undefined) {
    headers.set('Content-Type', contentType)
  }

  return isHeadRequest === true
    ? new Response(null, { status: 200, headers })
    : new Response(await readFile(absolutePath), { status: 200, headers })
}

const docsRoot = fileURLToPath(new URL('..', import.meta.url))

const headersFromIncoming = (incomingHeaders: IncomingHttpHeaders): Headers => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (value === undefined) continue
    if (Array.isArray(value) === true) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

const writeWebResponse = async (webResponse: Response, nodeResponse: ServerResponse): Promise<void> => {
  nodeResponse.statusCode = webResponse.status
  webResponse.headers.forEach((value, key) => nodeResponse.setHeader(key, value))

  if (webResponse.body === null) {
    nodeResponse.end()
    return
  }

  nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()))
}

const startServer = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const distDir = join(docsRoot, 'dist')
  if ((await directoryExists(distDir)) === false) {
    console.error('Docs dist folder not found. Run `mono docs build` first or pass `--build` to the preview command.')
    process.exit(1)
  }

  const port = args.port ?? Number.parseInt(process.env.PORT ?? '8888', 10)
  const host = args.host ?? '127.0.0.1'

  const server = createServer(async (request, response) => {
    try {
      const method = request.method?.toUpperCase() ?? 'GET'
      const isHeadRequest = method === 'HEAD'
      if (method !== 'GET' && isHeadRequest === false) {
        await writeWebResponse(new Response('Method Not Allowed', { status: 405 }), response)
        return
      }

      const requestHost = request.headers.host ?? `${host}:${port}`
      const requestUrl = new URL(request.url ?? '/', `http://${requestHost}`)
      const headers = headersFromIncoming(request.headers)

      if (isAssetPath(requestUrl.pathname) === false && preferredMarkdown(headers.get('Accept')) === true) {
        const markdownResponse = await createMarkdownResponse(distDir, requestUrl, isHeadRequest)
        if (markdownResponse !== undefined) {
          await writeWebResponse(markdownResponse, response)
          return
        }
      }

      const staticPath = await resolveStaticRelative(distDir, requestUrl.pathname)
      if (staticPath !== undefined) {
        const staticResponse = await createStaticResponse(distDir, staticPath, isHeadRequest)
        if (staticResponse !== undefined) {
          await writeWebResponse(staticResponse, response)
          return
        }
      }

      await writeWebResponse(new Response('Not Found', { status: 404 }), response)
    } catch (error) {
      console.error('Preview server encountered an unexpected error:', error)
      await writeWebResponse(new Response('Internal Server Error', { status: 500 }), response)
    }
  })

  await new Promise<void>((resolve) => server.listen({ host, port }, resolve))

  const address = server.address() as AddressInfo
  const previewUrl = `http://${address.address}:${address.port}`
  console.log(`Docs preview running at ${previewUrl}`)
  console.log('Press Ctrl+C to stop the server.')

  await new Promise<void>((resolve) => {
    const close = () => server.close(() => resolve())
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
  })
}

await startServer()
