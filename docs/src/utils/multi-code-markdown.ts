import { promises as fs } from 'node:fs'
import path from 'node:path'

type SnippetManifestEntry = {
  readonly entryFile?: string
  readonly artifactPath?: string
}

type SnippetManifest = {
  readonly entries: ReadonlyArray<SnippetManifestEntry>
}

type SnippetManifestCacheEntry = { raw: SnippetManifest; byEntry: Map<string, SnippetManifestEntry> }

type SnippetManifestCache = {
  manifest: SnippetManifestCacheEntry | null
}

type SnippetArtifactFile = {
  readonly content: string
}

type SnippetArtifact = {
  readonly files: Record<string, SnippetArtifactFile>
  readonly fileOrder?: ReadonlyArray<string>
}

type SnippetFile = {
  readonly filename: string
  readonly language: string
  readonly source: string
}

type TransformInput = {
  readonly id: string
  readonly collection?: string
  readonly body: string
  readonly debug?: boolean
  readonly docsRoot?: string
}

const SNIPPET_IMPORT_PATTERN = /^import\s+([A-Za-z_$][\w$]*)[^\n;]*from\s+['"]([^'"\n]+\?snippet)['"];?$/gm

type Paths = {
  readonly docsRoot: string
  readonly contentRoot: string
  readonly snippetRoot: string
  readonly snippetCacheRoot: string
  readonly snippetManifestPath: string
}

const resolvePaths = (docsRootOverride?: string): Paths => {
  const docsRoot = docsRootOverride ?? process.env.LS_DOCS_ROOT ?? process.cwd()
  const contentRoot = path.join(docsRoot, 'src', 'content')
  const snippetRoot = path.join(contentRoot, '_assets', 'code')
  const snippetCacheRoot = path.join(docsRoot, 'node_modules', '.astro-twoslash-code')
  const snippetManifestPath = path.join(snippetCacheRoot, 'manifest.json')
  return { docsRoot, contentRoot, snippetRoot, snippetCacheRoot, snippetManifestPath }
}

const snippetManifestCache = new Map<string, SnippetManifestCacheEntry>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isSnippetManifestEntry = (value: unknown): value is SnippetManifestEntry => {
  if (!isRecord(value)) return false
  const { entryFile, artifactPath } = value
  const hasEntryFile = entryFile === undefined || typeof entryFile === 'string'
  const hasArtifactPath = artifactPath === undefined || typeof artifactPath === 'string'
  return hasEntryFile && hasArtifactPath
}

const parseSnippetManifest = (source: string): SnippetManifest => {
  const parsed = JSON.parse(source) as unknown
  if (!isRecord(parsed)) {
    return { entries: [] }
  }

  const rawEntries = parsed.entries
  const entries = Array.isArray(rawEntries) ? rawEntries.filter(isSnippetManifestEntry) : []

  return { entries }
}

const parseSnippetArtifact = (source: string): SnippetArtifact | null => {
  const parsed = JSON.parse(source) as unknown
  if (!isRecord(parsed)) {
    return null
  }

  const filesRaw = parsed.files
  if (!isRecord(filesRaw)) {
    return null
  }

  const files: Record<string, SnippetArtifactFile> = {}
  for (const [key, value] of Object.entries(filesRaw)) {
    if (!isRecord(value)) continue
    const { content } = value
    if (typeof content !== 'string') continue
    files[key] = { content }
  }

  if (Object.keys(files).length === 0) {
    return null
  }

  const fileOrder = Array.isArray(parsed.fileOrder)
    ? parsed.fileOrder.filter((item): item is string => typeof item === 'string')
    : undefined

  return fileOrder !== undefined ? { files, fileOrder } : { files }
}

const loadSnippetManifest = async (paths: Paths): Promise<SnippetManifestCacheEntry> => {
  const cached = snippetManifestCache.get(paths.snippetManifestPath)
  if (cached) return cached

  const source = await fs.readFile(paths.snippetManifestPath, 'utf-8')
  const manifest = parseSnippetManifest(source)
  const entries = new Map<string, SnippetManifestEntry>()
  for (const entry of manifest.entries) {
    if (entry.entryFile) {
      entries.set(entry.entryFile, entry)
    }
  }

  const cacheEntry = { raw: manifest, byEntry: entries }
  snippetManifestCache.set(paths.snippetManifestPath, cacheEntry)
  return cacheEntry
}

const normalizeSourceForFence = (source: string): string => {
  const normalized = source.replace(/\r\n/g, '\n')
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
}

const renderFilesToMarkdown = (files: ReadonlyArray<SnippetFile>): string => {
  const sections = files.map((file, index) => {
    const headingLevel = index === 0 ? '##' : '###'
    const heading = `${headingLevel} \`${file.filename}\``
    const fenceToken = file.source.includes('```') ? '````' : '```'
    const infoParts: string[] = []
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

const escapeForRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')

const guessLanguageFromFilename = (filename: string): string => {
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

const resolveSnippetEntryPath = (specifier: string, docDir: string, paths: Paths): string | null => {
  const [rawPath] = specifier.split('?')
  if (!rawPath) return null

  const absolutePath = path.resolve(docDir, rawPath)
  const relativeToRoot = path.relative(paths.snippetRoot, absolutePath).replace(/\\/g, '/')
  if (relativeToRoot.startsWith('..')) return null
  return relativeToRoot
}

const loadSnippetFiles = async (entryFile: string | null, paths: Paths): Promise<ReadonlyArray<SnippetFile>> => {
  if (!entryFile) return []
  const manifest = await loadSnippetManifest(paths)
  const metadata = manifest.byEntry.get(entryFile)
  if (!metadata?.artifactPath) {
    return []
  }

  const artefactSource = await fs.readFile(path.join(paths.snippetCacheRoot, metadata.artifactPath), 'utf-8')
  const artefact = parseSnippetArtifact(artefactSource)
  if (!artefact) {
    return []
  }

  const order = artefact.fileOrder ?? Object.keys(artefact.files)
  const files: SnippetFile[] = []

  for (const filename of order) {
    const record = artefact.files[filename]
    if (!record) continue
    files.push({ filename, language: guessLanguageFromFilename(filename), source: record.content })
  }

  return files
}

const replaceComponentWithMarkdown = (body: string, identifier: string, markdown: string | undefined): string => {
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

const extractSnippetNamespaceMappings = (
  body: string,
): { readonly cleanedBody: string; readonly namespaceMap: Map<string, string> } => {
  const namespaceMap = new Map<string, string>()
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
    const [, property, identifier] = match
    if (property && identifier) {
      namespaceMap.set(property, identifier)
    }
    match = propertyPattern.exec(objectSource)
  }

  let removalEnd = endIndex + 1
  while (removalEnd < body.length) {
    const char = body[removalEnd]
    if (char === undefined || !/[\s;]/.test(char)) break
    removalEnd += 1
  }

  const cleanedBody = `${body.slice(0, startIndex)}${body.slice(removalEnd)}`

  return { cleanedBody, namespaceMap }
}

export const transformMultiCodeDocument = async (input: TransformInput): Promise<string> => {
  const { id, collection, body, debug = false, docsRoot } = input
  const paths = resolvePaths(docsRoot)
  const docCollection = collection ?? 'docs'
  const normalizedDocPath = docCollection && id.startsWith(`${docCollection}/`) ? id : `${docCollection}/${id}`
  const docDir = path.dirname(path.join(paths.contentRoot, normalizedDocPath))

  const snippetImports = new Map<string, string>()
  let workingBody = body.replace(SNIPPET_IMPORT_PATTERN, (_match, identifier: string, specifier: string) => {
    snippetImports.set(identifier, specifier)
    return ''
  })

  const { cleanedBody, namespaceMap } = extractSnippetNamespaceMappings(workingBody)
  workingBody = cleanedBody

  const markdownByIdentifier = new Map<string, string>()

  for (const [identifier, specifier] of snippetImports.entries()) {
    const entryPath = resolveSnippetEntryPath(specifier, docDir, paths)
    const files = await loadSnippetFiles(entryPath, paths)

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
