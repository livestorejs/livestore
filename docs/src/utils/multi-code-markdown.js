import { promises as fs } from 'node:fs'
import path from 'node:path'

const SNIPPET_IMPORT_PATTERN = /^import\s+([A-Za-z_$][\w$]*)[^\n;]*from\s+['"]([^'"\n]+\?snippet)['"];?$/gm

const DOCS_ROOT = process.cwd()
const CONTENT_ROOT = path.join(DOCS_ROOT, 'src', 'content')
const SNIPPET_ROOT = path.join(CONTENT_ROOT, '_assets', 'code')
const SNIPPET_CACHE_ROOT = path.join(DOCS_ROOT, 'node_modules', '.astro-twoslash-code')
const SNIPPET_MANIFEST_PATH = path.join(SNIPPET_CACHE_ROOT, 'manifest.json')

const snippetManifestCache = { manifest: null }

const loadSnippetManifest = async () => {
  if (snippetManifestCache.manifest) {
    return snippetManifestCache.manifest
  }

  const source = await fs.readFile(SNIPPET_MANIFEST_PATH, 'utf-8')
  const manifest = JSON.parse(source)
  const entries = new Map()
  for (const entry of manifest.entries ?? []) {
    if (entry?.entryFile) {
      entries.set(entry.entryFile, entry)
    }
  }

  snippetManifestCache.manifest = { raw: manifest, byEntry: entries }
  return snippetManifestCache.manifest
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
    if (file.language.length > 0) {
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
  const manifest = await loadSnippetManifest()
  const metadata = manifest.byEntry.get(entryFile)
  if (!metadata?.artifactPath) {
    return []
  }

  const artefactSource = await fs.readFile(path.join(SNIPPET_CACHE_ROOT, metadata.artifactPath), 'utf-8')
  const artefact = JSON.parse(artefactSource)
  if (!artefact.files || typeof artefact.files !== 'object') {
    return []
  }

  const order = Array.isArray(artefact.fileOrder) ? artefact.fileOrder : Object.keys(artefact.files)
  const files = []

  for (const filename of order) {
    const record = artefact.files[filename]
    if (!record || typeof record.content !== 'string') continue
    files.push({ filename, language: guessLanguageFromFilename(filename), source: record.content })
  }

  return files
}

const replaceComponentWithMarkdown = (body, identifier, markdown) => {
  if (!markdown) return body

  const escaped = escapeForRegex(identifier)
  const blockPattern = new RegExp(String.raw`\n?[\t ]*<${escaped}(?:\s[^>]*)?>[\s\S]*?</${escaped}>\s*`, 'g')
  const selfClosingPattern = new RegExp(String.raw`\n?[\t ]*<${escaped}(?:\s[^>]*)?/>\s*`, 'g')

  /*
   Preserve literal `$` sequences in snippets (e.g. `todos$`) by using a
   function replacer—string replacers treat `$` as backreference syntax and
   would splice in unrelated text.
  */
  const replacement = () => `\n\n${markdown}\n\n`

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

  let depth = 0
  let endIndex = -1
  for (let i = braceStart; i < body.length; i += 1) {
    const char = body[i]
    if (char === '{') depth += 1
    else if (char === '}') {
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

export const transformMultiCodeDocument = async ({ id, collection, body, debug = false }) => {
  const docCollection = collection ?? 'docs'
  const normalizedDocPath = docCollection && id.startsWith(`${docCollection}/`) ? id : `${docCollection}/${id}`
  const docDir = path.dirname(path.join(CONTENT_ROOT, normalizedDocPath))

  const snippetImports = new Map()
  let workingBody = body.replace(SNIPPET_IMPORT_PATTERN, (_, identifier, specifier) => {
    snippetImports.set(identifier, specifier)
    return ''
  })

  const { cleanedBody, namespaceMap } = extractSnippetNamespaceMappings(workingBody)
  workingBody = cleanedBody

  const markdownByIdentifier = new Map()

  for (const [identifier, specifier] of snippetImports.entries()) {
    const entryPath = resolveSnippetEntryPath(specifier, docDir)
    const files = await loadSnippetFiles(entryPath)

    if (debug) {
      // eslint-disable-next-line no-console
      console.debug('[llm-markdown] transform', {
        id,
        identifier,
        specifier,
        entryPath,
        files: files.length,
      })
    }

    if (files.length === 0) continue

    const markdown = renderFilesToMarkdown(files)
    markdownByIdentifier.set(identifier, markdown)
    workingBody = replaceComponentWithMarkdown(workingBody, identifier, markdown)
  }

  for (const [property, identifier] of namespaceMap.entries()) {
    const markdown = markdownByIdentifier.get(identifier)
    if (!markdown) continue
    workingBody = replaceComponentWithMarkdown(workingBody, `SNIPPETS.${property}`, markdown)
  }

  return workingBody.replace(/^\s*\n/, '')
}
