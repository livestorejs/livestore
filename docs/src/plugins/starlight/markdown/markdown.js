/**
 * Runtime for the LiveStore markdown routes consumed by the contextual menu.
 *
 * Responsibilities:
 * - expose `/index.md` and `/[...path]/index.md` so copy/view actions can fetch
 *   raw markdown even when the docs page was authored in MDX.
 * - normalise `astro:content` entries to slugs that match the public docs URLs
 *   (the upstream package returns `doc.id` which breaks nested routes).
 *
 * Keep behaviour aligned with the `starlight-markdown` package signature because
 * the contextual menu imports it directly before our Vite aliases apply.
 */

import { getCollection, getEntry } from 'astro:content'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const normalizeDocPath = (p) => {
  if (!p) return 'index'
  let pathValue = String(p)
  pathValue = pathValue.replace(/^docs\//, '')
  pathValue = pathValue.replace(/\/index$/, '')
  pathValue = pathValue.replace(/\.(md|mdx)$/i, '')
  return pathValue === '' ? 'index' : pathValue
}

const staticPathFromDoc = (doc) => {
  const slug = typeof doc.slug === 'string' ? doc.slug.replace(/^\//, '') : undefined
  return slug && slug !== '' ? slug : normalizeDocPath(doc.id)
}

const SNIPPET_IMPORT_PATTERN = /^import\s+([A-Za-z_$][\w$]*)[^\n;]*from\s+['"]([^'"\n]+\?snippet)['"];?$/gm

const DOCS_ROOT = process.cwd()
const CONTENT_ROOT = path.join(DOCS_ROOT, 'src', 'content')
const SNIPPET_ROOT = path.join(CONTENT_ROOT, '_assets', 'code')
const SNIPPET_CACHE_ROOT = path.join(DOCS_ROOT, 'node_modules', '.astro-twoslash-code')
const SNIPPET_MANIFEST_PATH = path.join(SNIPPET_CACHE_ROOT, 'manifest.json')

const snippetManifestCache = {
  manifest: null,
  entries: null,
}

const loadSnippetManifest = async () => {
  if (snippetManifestCache.manifest && snippetManifestCache.entries) {
    return snippetManifestCache
  }

  try {
    // The manifest mirrors the snippets we prerendered for the interactive UI.
    const source = await fs.readFile(SNIPPET_MANIFEST_PATH, 'utf-8')
    const manifest = JSON.parse(source)
    const rawEntries = Array.isArray(manifest?.entries) ? manifest.entries : []
    const entries = new Map()
    for (const entry of rawEntries) {
      if (typeof entry?.entryFile === 'string') {
        entries.set(entry.entryFile, entry)
      }
    }
    snippetManifestCache.manifest = manifest
    snippetManifestCache.entries = entries
  } catch (error) {
    console.error('Unable to load Twoslash snippet manifest', error)
    snippetManifestCache.manifest = null
    snippetManifestCache.entries = new Map()
  }

  return snippetManifestCache
}

const normalizeSourceForFence = (source) => {
  const normalized = source.replace(/\r\n/g, '\n')
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
}

const renderFilesToMarkdown = (files) => {
  const sections = files.map((file, index) => {
    const headingLevel = index === 0 ? '##' : '###'
    const heading = `${headingLevel} \`${file.filename}\``
    const fenceToken = file.source.includes('```') ? '````' : '```'
    const infoParts = []
    if (typeof file.language === 'string' && file.language.length > 0) {
      infoParts.push(file.language)
    }
    infoParts.push(`filename="${file.filename}"`)

    let fenceHeader = fenceToken
    if (infoParts.length > 0) {
      fenceHeader += infoParts[0]
      if (infoParts.length > 1) {
        fenceHeader += ` ${infoParts.slice(1).join(' ')}`
      }
    }
    const body = normalizeSourceForFence(file.source)

    return [heading, '', fenceHeader, body, fenceToken].join('\n')
  })

  return sections.join('\n\n')
}

const escapeForRegex = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')

const guessLanguageFromFilename = (filename) => {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'ts' || extension === 'cts' || extension === 'mts') return 'ts'
  if (extension === 'tsx') return 'tsx'
  if (extension === 'js' || extension === 'cjs' || extension === 'mjs') return 'js'
  if (extension === 'jsx') return 'jsx'
  if (extension === 'astro') return 'astro'
  if (extension === 'json') return 'json'
  if (extension === 'yaml' || extension === 'yml') return 'yaml'
  if (extension === 'css' || extension === 'scss') return 'css'
  if (extension === 'html') return 'html'
  if (extension === 'md' || extension === 'mdx') return 'md'
  if (extension === 'sh' || extension === 'bash') return 'bash'
  if (extension === 'vue') return 'vue'
  if (extension === 'txt') return 'plaintext'
  return extension.length > 0 ? extension : 'ts'
}

const resolveSnippetEntryPath = (specifier, docDir) => {
  const [rawPath] = specifier.split('?')
  if (!rawPath) return null

  const absolutePath = path.resolve(docDir, rawPath)
  const relativeToRoot = path.relative(SNIPPET_ROOT, absolutePath).replace(/\\/g, '/')
  if (relativeToRoot.startsWith('..')) return null
  return relativeToRoot
}

const loadSnippetFiles = async (entryFile) => {
  if (!entryFile) return []
  const { manifest, entries } = await loadSnippetManifest()
  if (!manifest || !entries?.has(entryFile)) {
    return []
  }

  const metadata = entries.get(entryFile)
  const artifactPath = typeof metadata?.artifactPath === 'string' ? metadata.artifactPath : null
  if (!artifactPath) {
    return []
  }

  try {
    const artefactSource = await fs.readFile(path.join(SNIPPET_CACHE_ROOT, artifactPath), 'utf-8')
    const artefact = JSON.parse(artefactSource)
    const filesRecord = artefact?.files
    if (!filesRecord || typeof filesRecord !== 'object') {
      return []
    }

    const order = Array.isArray(artefact.fileOrder) ? artefact.fileOrder : Object.keys(filesRecord)
    const files = []

    for (const filename of order) {
      const record = filesRecord[filename]
      if (!record || typeof record.content !== 'string') {
        continue
      }
      files.push({
        filename,
        language: guessLanguageFromFilename(filename),
        source: record.content,
      })
    }

    return files
  } catch (error) {
    console.error(`Failed to read snippet artefact for ${entryFile}`, error)
    return []
  }
}

const replaceComponentWithMarkdown = (body, identifier, markdown) => {
  if (!markdown) return body

  const escaped = escapeForRegex(identifier)
  const blockPattern = new RegExp(String.raw`\n?[\t ]*<${escaped}(?:\s[^>]*)?>[\s\S]*?</${escaped}>\s*`, 'g')
  const selfClosingPattern = new RegExp(String.raw`\n?[\t ]*<${escaped}(?:\s[^>]*)?/>\s*`, 'g')

  const replacement = `\n\n${markdown}\n\n`

  let transformed = body.replace(blockPattern, replacement)
  transformed = transformed.replace(selfClosingPattern, replacement)
  return transformed
}

const extractSnippetNamespaceMappings = (body) => {
  const namespaceMap = new Map()
  const token = 'export const SNIPPETS'
  const startIndex = body.indexOf(token)
  if (startIndex === -1) {
    return { cleanedBody: body, namespaceMap }
  }

  const braceStart = body.indexOf('{', startIndex)
  if (braceStart === -1) {
    return { cleanedBody: body, namespaceMap }
  }

  // Walk the braces manually because nested spreads or trailing commas would
  // confuse a naive split; we only care about the first level.
  let depth = 0
  let endIndex = -1
  for (let i = braceStart; i < body.length; i += 1) {
    const char = body[i]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        endIndex = i
        break
      }
    }
  }

  if (endIndex === -1) {
    return { cleanedBody: body, namespaceMap }
  }

  const objectSource = body.slice(braceStart + 1, endIndex)
  const propertyPattern = /([A-Za-z0-9_$]+)\s*:\s*([A-Za-z0-9_$]+)/g
  let match = propertyPattern.exec(objectSource)
  while (match) {
    namespaceMap.set(match[1], match[2])
    match = propertyPattern.exec(objectSource)
  }

  let removalEnd = endIndex + 1
  while (removalEnd < body.length && /[\s;]/.test(body[removalEnd])) {
    removalEnd += 1
  }

  const cleanedBody = `${body.slice(0, startIndex)}${body.slice(removalEnd)}`

  return { cleanedBody, namespaceMap }
}

const transformMultiCodeBlocks = async (doc) => {
  const rawBody = typeof doc?.body === 'string' ? doc.body : ''
  if (rawBody.length === 0) {
    return rawBody
  }

  const docId = typeof doc?.id === 'string' ? doc.id : ''
  const docCollection = typeof doc?.collection === 'string' ? doc.collection : ''

  const normalizedDocPath = (() => {
    if (docCollection && docId.startsWith(`${docCollection}/`)) {
      return docId
    }
    if (docCollection) {
      return `${docCollection}/${docId}`
    }
    return docId
  })()

  const docDir = normalizedDocPath.length > 0 ? path.dirname(path.join(CONTENT_ROOT, normalizedDocPath)) : CONTENT_ROOT

  const snippetImports = new Map()
  let workingBody = rawBody.replace(SNIPPET_IMPORT_PATTERN, (_, identifier, specifier) => {
    snippetImports.set(identifier, specifier)
    return ''
  })

  const { cleanedBody, namespaceMap } = extractSnippetNamespaceMappings(workingBody)
  workingBody = cleanedBody

  const shouldLogDebug = process.env.LS_DEBUG_MARKDOWN === '1'

  const markdownByIdentifier = new Map()

  for (const [identifier, specifier] of snippetImports.entries()) {
    const entryPath = resolveSnippetEntryPath(specifier, docDir)
    const files = await loadSnippetFiles(entryPath)

    if (shouldLogDebug) {
      // Useful when debugging via `LS_DEBUG_MARKDOWN=1`: see which snippets were
      // recovered and which fallback to HTML.
      console.debug('[markdown] multi-code transform', {
        docId,
        identifier,
        specifier,
        entryPath,
        files: files.length,
      })
    }
    if (files.length === 0) {
      continue
    }

    const markdown = renderFilesToMarkdown(files)
    markdownByIdentifier.set(identifier, markdown)
    workingBody = replaceComponentWithMarkdown(workingBody, identifier, markdown)
  }

  for (const [property, identifier] of namespaceMap.entries()) {
    const markdown = markdownByIdentifier.get(identifier)
    if (!markdown) {
      continue
    }

    // Map `<SNIPPETS.foo />` alias usage back to the concrete snippet component.
    workingBody = replaceComponentWithMarkdown(workingBody, `SNIPPETS.${property}`, markdown)
  }

  return workingBody.replace(/^\s*\n/, '')
}

export async function GET({ params }) {
  const key = normalizeDocPath(params?.path)

  const docs = await getCollection('docs')

  const findMatch = () => {
    for (const doc of docs) {
      const idNorm = normalizeDocPath(doc.id)
      const slugNorm = staticPathFromDoc(doc)
      if (idNorm === key || doc.slug === key) return doc
      if (idNorm === `${key}/index`) return doc
      if (`${idNorm}/index` === key) return doc
      if (slugNorm === key) return doc
      if (slugNorm === `${key}/index`) return doc
    }
    return undefined
  }

  let doc = findMatch()

  if (!doc) {
    const candidates = [key, `${key}.mdx`, `${key}.md`, `${key}/index`, `${key}/index.mdx`, `${key}/index.md`]
    for (const c of candidates) {
      try {
        const entry = await getEntry('docs', c)
        if (entry) {
          doc = entry
          break
        }
      } catch (_) {}
    }
  }

  if (!doc) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  const title = doc.data?.title ?? doc.slug ?? key
  const transformedBody = await transformMultiCodeBlocks(doc)
  const markdown = `# ${title}\n\n${transformedBody}`

  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
    },
  })
}

export async function getStaticPaths() {
  const docs = await getCollection('docs')
  const paths = docs
    .map((doc) => staticPathFromDoc(doc))
    .filter((p) => p !== 'index')
    .map((p) => ({ params: { path: p } }))

  return paths
}
