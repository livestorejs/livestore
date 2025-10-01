/**
 * Shared server-side helpers for the `<MultiCode />` component.
 *
 * Responsibilities:
 *   - Normalize snippet bundles (filenames, main file ordering, pre-rendered metadata).
 *   - Merge render-time artefacts (HTML, styles, diagnostics) into tab descriptors.
 *   - Surface global twoslash assets exactly once per page (base/theme styles + JS modules).
 *
 * The returned `PreparedMultiCode` object is consumed by `MultiCode.astro` to render the tab UI.
 */
type SnippetGlobals = {
  baseStyles: string | null
  themeStyles: string | null
  jsModules: string[]
}

export type RawSnippetFile = {
  filename: string
  content: string
  isMain: boolean
  hash: string
}

export type RenderedSnippet = {
  filename?: string
  html: string | null
  language: string
  meta: string
  diagnostics: string[]
  styles?: string[]
}

export type SnippetBundle = {
  files: Record<string, Omit<RawSnippetFile, 'filename'>> | RawSnippetFile[]
  fileOrder?: string[]
  mainFilename: string | null
  rendered?: Record<string, Omit<RenderedSnippet, 'filename'>> | RenderedSnippet[]
  globals?: {
    baseStyles?: string
    themeStyles?: string
    jsModules?: string[]
  } | null
}

export type MultiCodeProps = {
  code: SnippetBundle
  lang?: string
  meta?: string
  locale?: string
  class?: string
  title?: string
  [key: string]: unknown
}

export type MultiCodeTab = {
  filename: string
  baseName: string
  language: string
  html: string | null
  styles: string[]
  meta: string
  isMain: boolean
  diagnostics: string[]
}

export type PreparedMultiCode = {
  panels: MultiCodeTab[]
  activeMeta: string
  containerClass: string
  baseId: string
  locale?: string
  globals: SnippetGlobals
}

const normalizeFilename = (name: string): string => name.replace(/^[./]+/, '').replace(/\\/g, '/')

const guessLanguage = (filename: string, fallback?: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) return fallback ?? 'ts'
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
  return extension
}

const normalizeGlobals = (globals: SnippetBundle['globals']): SnippetGlobals => ({
  baseStyles: typeof globals?.baseStyles === 'string' && globals.baseStyles.length > 0 ? globals.baseStyles : null,
  themeStyles: typeof globals?.themeStyles === 'string' && globals.themeStyles.length > 0 ? globals.themeStyles : null,
  jsModules: Array.isArray(globals?.jsModules)
    ? globals.jsModules.filter((module): module is string => typeof module === 'string' && module.length > 0)
    : [],
})

export const prepareMultiCodeData = (props: MultiCodeProps): PreparedMultiCode => {
  const { code, lang: rawLang, meta: rawMeta, locale, class: rawClassName, title: _unusedTitle } = props

  const fallbackLang = typeof rawLang === 'string' && rawLang.length > 0 ? rawLang : undefined
  const activeMeta = typeof rawMeta === 'string' && rawMeta.length > 0 ? rawMeta : 'twoslash'
  const className = typeof rawClassName === 'string' && rawClassName.length > 0 ? rawClassName : undefined

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

  const normalizedFilesMap = (() => {
    if (isRecord(code?.files) && !Array.isArray(code?.files)) {
      return Object.entries(code.files).reduce<Record<string, RawSnippetFile>>((acc, [key, value]) => {
        if (!isRecord(value)) return acc
        const filename = normalizeFilename(key)
        const hash = value.hash
        if (typeof hash !== 'string' || hash.length === 0) {
          throw new Error(`Snippet file '${filename}' is missing a hash.`)
        }
        acc[filename] = {
          filename,
          content: typeof value.content === 'string' ? value.content : '',
          isMain: value.isMain === true,
          hash,
        }
        return acc
      }, {})
    }

    if (Array.isArray(code?.files)) {
      return code.files.reduce<Record<string, RawSnippetFile>>((acc, entry) => {
        if (!entry) return acc
        const filename = normalizeFilename(entry.filename ?? 'snippet.ts')
        const hash = (entry as { hash?: string }).hash
        if (typeof hash !== 'string' || hash.length === 0) {
          throw new Error(`Snippet file '${filename}' is missing a hash.`)
        }
        acc[filename] = {
          filename,
          content: entry.content ?? '',
          isMain: entry.isMain === true,
          hash,
        }
        return acc
      }, {})
    }

    return {}
  })()

  const fileOrder =
    Array.isArray(code?.fileOrder) && code.fileOrder.length > 0
      ? code.fileOrder.map((filename) => normalizeFilename(filename))
      : Object.keys(normalizedFilesMap)

  const fileEntries: RawSnippetFile[] = fileOrder.map((filename) => {
    const record = normalizedFilesMap[filename]
    if (!record) {
      throw new Error(`Missing snippet metadata for '${filename}'.`)
    }
    return record
  })

  const renderedMap = new Map<string, RenderedSnippet>()
  if (isRecord(code?.rendered) && !Array.isArray(code.rendered)) {
    for (const [key, value] of Object.entries(code.rendered)) {
      if (!isRecord(value)) continue
      const filename = normalizeFilename(key)
      renderedMap.set(filename, {
        filename,
        html: typeof value.html === 'string' ? value.html : null,
        language: typeof value.language === 'string' ? value.language : 'ts',
        meta: typeof value.meta === 'string' && value.meta.length > 0 ? value.meta : activeMeta,
        diagnostics: Array.isArray(value.diagnostics)
          ? value.diagnostics.filter((item): item is string => typeof item === 'string')
          : [],
        styles: Array.isArray(value.styles)
          ? value.styles.filter((item): item is string => typeof item === 'string')
          : [],
      })
    }
  } else if (Array.isArray(code?.rendered)) {
    for (const entry of code.rendered) {
      if (!entry) continue
      const filename = normalizeFilename(entry.filename ?? 'snippet.ts')
      renderedMap.set(filename, {
        filename,
        html: entry.html ?? null,
        language: entry.language,
        meta: entry.meta ?? activeMeta,
        diagnostics: Array.isArray(entry.diagnostics) ? entry.diagnostics : [],
        styles: Array.isArray(entry.styles) ? entry.styles : [],
      })
    }
  }

  if (fileEntries.length === 0) {
    throw new Error('Snippet bundle does not contain any files.')
  }

  let preferredMain: string | null = null
  if (typeof code?.mainFilename === 'string' && code.mainFilename.length > 0) {
    preferredMain = normalizeFilename(code.mainFilename)
  }
  if (!preferredMain) {
    const flagged = fileEntries.find((file) => file.isMain)
    if (flagged) preferredMain = flagged.filename
  }
  if (!preferredMain) {
    preferredMain = fileEntries[0]!.filename
  }

  const orderedFiles = (() => {
    const currentIndex = fileEntries.findIndex((file) => file.filename === preferredMain)
    if (currentIndex > 0) {
      const updated = [...fileEntries]
      updated.unshift(updated.splice(currentIndex, 1)[0]!)
      return updated
    }
    if (currentIndex === -1 && preferredMain) {
      throw new Error(`Main snippet file '${preferredMain}' is missing from metadata.`)
    }
    return fileEntries
  })()

  const panels: MultiCodeTab[] = orderedFiles.map((file) => {
    const parts = file.filename.split('/')
    const baseName = parts.length > 0 ? parts[parts.length - 1] || file.filename : file.filename

    const isMain = file.filename === preferredMain
    const rendered = renderedMap.get(file.filename)
    const language = rendered?.language ?? guessLanguage(file.filename, fallbackLang)
    const meta = rendered?.meta ?? activeMeta
    const diagnostics = rendered?.diagnostics ?? []
    const styles = rendered?.styles ?? []
    const html = typeof rendered?.html === 'string' && rendered.html.length > 0 ? rendered.html : null

    return {
      filename: file.filename,
      baseName,
      language,
      html,
      styles,
      meta,
      isMain,
      diagnostics,
    }
  })

  const containerClass = ['ls-multi-code', className].filter(Boolean).join(' ')
  const firstPanel = panels[0]
  let baseSlug = 'snippet'
  if (firstPanel?.baseName) {
    const slug = firstPanel.baseName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
    baseSlug = slug.length > 0 ? slug : 'snippet'
  }
  const baseId = `ls-multi-code-${baseSlug}`

  return {
    panels,
    activeMeta,
    containerClass,
    baseId,
    globals: normalizeGlobals(code?.globals ?? null),
    ...(locale ? { locale } : {}),
  }
}
