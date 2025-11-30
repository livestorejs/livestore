import path from 'node:path'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FileSystem, PlatformError, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { transformMultiCodeDocument } from '@local/docs/multi-code-markdown'

export const exportMarkdownCommand = Cli.Command.make(
  'export-markdown',
  {
    out: Cli.Options.text('out').pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Destination directory for the exported markdown tree'),
    ),
    workspaceRoot: Cli.Options.text('workspace-root').pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Workspace root (defaults to WORKSPACE_ROOT)'),
    ),
    includeLlms: Cli.Options.boolean('include-llms').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Also emit llms.txt alongside index.md'),
    ),
  },
  Effect.fn(function* ({ out, includeLlms, workspaceRoot: workspaceRootOption }) {
    const workspaceRoot =
      workspaceRootOption._tag === 'Some'
        ? workspaceRootOption.value
        : process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
    const docsRoot = path.join(workspaceRoot, 'docs')
    const contentRoot = path.join(docsRoot, 'src', 'content', 'docs')
    const outputDir =
      out._tag === 'Some' ? path.resolve(out.value) : path.join(workspaceRoot, 'packages', '@livestore', 'livestore', 'docs')

    yield* assertSnippetManifest(docsRoot)

    const docs = yield* loadDocs(contentRoot)

    const llmsDocs: ReadonlyArray<TLlmsDoc> = docs
      .filter((doc) => !doc.slug.startsWith('api/'))
      .map((doc) => ({
        title: doc.title,
        description: doc.description,
        slug: doc.slug,
      }))

    const exportEffect = Effect.gen(function* () {
      for (const doc of docs) {
        const transformed = yield* Effect.promise(() =>
          transformMultiCodeDocument({
            id: doc.id,
            collection: 'docs',
            body: doc.body,
            docsRoot,
          }),
        )

        const cleaned = stripLeadingImports(transformed).trim()
        const markdown = replaceLlmsShortPlaceholders({
          markdown: cleaned,
          docs: llmsDocs,
          site: null,
        })
        const final = `# ${doc.title}\n\n${markdown}\n`
        yield* writeDoc(outputDir, doc, final)
      }

      if (includeLlms) {
        const fs = yield* FileSystem.FileSystem
        const llmsList = renderLlmsList({ docs: llmsDocs, site: null })
        const llmsBody =
          '# LiveStore Documentation for LLMs\n\n> LiveStore is a client-centric local-first data layer for high-performance apps based on SQLite and event-sourcing.\n\n## Notes\n\n- Most LiveStore APIs are synchronous and don\'t need `await`\n\n## Docs\n\n' +
          llmsList
        yield* fs.writeFileString(path.join(outputDir, 'llms.txt'), `${llmsBody.trimEnd()}\n`)
      }

      yield* Effect.log(`Exported ${docs.length} docs to ${outputDir}`)
    })

    yield* exportEffect
  }),
)

export class SnippetManifestMissing extends Schema.TaggedError<SnippetManifestMissing>()('SnippetManifestMissing', {
  message: Schema.String,
  checked: Schema.Array(Schema.String),
}) {}

type DocMeta = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly description: string | undefined
  readonly body: string
}

type TLlmsDoc = {
  readonly title: string
  readonly description: string | undefined
  readonly slug: string
}

const collectMarkdownEntries = (dir: string): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const entries = yield* fs.readDirectory(dir)
    const files: string[] = []

    for (const entry of entries) {
      if (entry.startsWith('_')) continue
      const absolute = path.join(dir, entry)
      const metadata = yield* fs.stat(absolute)

      if (metadata.type === 'Directory') {
        const nested = yield* collectMarkdownEntries(absolute)
        files.push(...nested)
        continue
      }

      if (metadata.type === 'File' && /\.(md|mdx)$/iu.test(entry)) {
        files.push(absolute)
      }
    }

    return files
  })

const parseFrontmatter = (
  source: string,
): { readonly title: string | undefined; readonly description: string | undefined; readonly body: string } => {
  if (!source.startsWith('---')) {
    return { title: undefined, description: undefined, body: source }
  }

  const endIndex = source.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { title: undefined, description: undefined, body: source }
  }

  const frontmatterRaw = source.slice(3, endIndex).trim()
  const body = source.slice(endIndex + 4)
  const titleMatch = frontmatterRaw.match(/^\s*title:\s*(.+)$/m)
  const descriptionMatch = frontmatterRaw.match(/^\s*description:\s*(.+)$/m)

  const clean = (value: string | undefined) => {
    if (!value) return undefined
    const trimmed = value.trim()
    const unquoted = trimmed.replace(/^['"]|['"]$/g, '')
    return unquoted
  }

  return {
    title: clean(titleMatch?.[1]),
    description: clean(descriptionMatch?.[1]),
    body,
  }
}

const toSlug = (absolutePath: string, contentRoot: string): string => {
  const relative = path.relative(contentRoot, absolutePath).replace(/\\/g, '/')
  const withoutExt = relative.replace(/\.(md|mdx)$/iu, '')
  if (withoutExt.endsWith('/index')) {
    return withoutExt.replace(/\/index$/u, '')
  }
  if (withoutExt === 'index') return ''
  return withoutExt
}

const loadDocs = (contentRoot: string): Effect.Effect<ReadonlyArray<DocMeta>, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const entries = yield* collectMarkdownEntries(contentRoot)
    const docs: DocMeta[] = []

    for (const filePath of entries) {
      const raw = yield* fs.readFileString(filePath)
      const { title, description, body } = parseFrontmatter(raw)
      const slug = toSlug(filePath, contentRoot)
      const derivedTitle = title ?? (slug === '' ? 'LiveStore' : slug.split('/').pop() ?? 'LiveStore')

      docs.push({
        id: `docs/${path.relative(contentRoot, filePath).replace(/\\/g, '/')}`,
        slug,
        title: derivedTitle,
        description,
        body,
      })
    }

    return docs
  })

const LLMS_SHORT_PATTERN = /<LlmsShort[^>]*\/>/g

const resolveHref = (value: string, site: URL | string | null | undefined): string => {
  if (site instanceof URL) {
    return new URL(value, site).href
  }
  if (typeof site === 'string' && site.length > 0) {
    try {
      return new URL(value, site).href
    } catch (_error) {
      // fall through
    }
  }
  return value.length === 0 ? '/' : `/${value}`
}

const renderLlmsList = ({ docs, site }: { readonly docs: ReadonlyArray<TLlmsDoc>; readonly site: URL | string | null }) =>
  docs
    .map((doc) => {
      const href = resolveHref(doc.slug, site)
      const suffix = doc.description && doc.description.length > 0 ? `: ${doc.description}` : ''
      return `- [${doc.title}](${href}/)${suffix}\n`
    })
    .join('')

const replaceLlmsShortPlaceholders = ({
  markdown,
  docs,
  site,
}: {
  readonly markdown: string
  readonly docs: ReadonlyArray<TLlmsDoc>
  readonly site: URL | string | null
}): string => {
  if (!markdown.includes('<LlmsShort')) {
    return markdown
  }
  const docsSection = renderLlmsList({ docs, site }).trimEnd()
  return markdown.replace(LLMS_SHORT_PATTERN, `${docsSection}\n`)
}

const stripLeadingImports = (body: string): string =>
  body
    .replace(/^\s*import\s+.*$/gm, '')
    .replace(/^\s*export const\s+SNIPPETS[\s\S]*?\n\n/gm, '')
    .replace(/\n{3,}/g, '\n\n')

const assertSnippetManifest = (docsRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const candidates = [
      path.join(docsRoot, 'node_modules', '.astro-twoslash-code', 'manifest.json'),
      path.join(docsRoot, 'docs', 'node_modules', '.astro-twoslash-code', 'manifest.json'),
    ]
    for (const candidate of candidates) {
      if (yield* fs.exists(candidate)) {
        return
      }
    }
    return yield* Effect.fail(
      new SnippetManifestMissing({
        message: 'Snippet manifest not found. Run "bun ./scripts/src/mono.ts docs snippets build" first.',
        checked: candidates,
      }),
    )
  })

const writeDoc = (outputRoot: string, doc: DocMeta, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const relativePath = doc.slug === '' ? 'index.md' : path.join(doc.slug, 'index.md')
    const targetPath = path.join(outputRoot, relativePath)
    yield* fs.makeDirectory(path.dirname(targetPath), { recursive: true })
    yield* fs.writeFileString(targetPath, `${content.trimEnd()}\n`)
  })