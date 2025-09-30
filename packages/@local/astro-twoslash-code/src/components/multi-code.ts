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
  isMain?: boolean
}

export type RenderedSnippet = {
  filename: string
  html: string | null
  language: string
  meta: string
  diagnostics: string[]
  styles?: string[]
}

export type SnippetBundle = {
  files: RawSnippetFile[]
  mainFilename: string | null
  rendered?: RenderedSnippet[]
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

  const rawFiles = Array.isArray(code?.files) ? code.files : []
  const files = rawFiles.map((file) => ({
    filename: normalizeFilename(file.filename ?? 'snippet.ts'),
    content: file.content ?? '',
    isMain: file.isMain === true,
  }))

  const renderedMap = new Map<string, RenderedSnippet>()
  if (Array.isArray(code?.rendered)) {
    for (const entry of code.rendered) {
      renderedMap.set(normalizeFilename(entry.filename), {
        filename: normalizeFilename(entry.filename),
        html: entry.html ?? null,
        language: entry.language,
        meta: entry.meta ?? activeMeta,
        diagnostics: Array.isArray(entry.diagnostics) ? entry.diagnostics : [],
        styles: Array.isArray(entry.styles) ? entry.styles : [],
      })
    }
  }

  if (files.length === 0) {
    files.push({ filename: 'snippet.ts', content: '', isMain: true })
  }

  let preferredMain: string | null = null
  if (typeof code?.mainFilename === 'string' && code.mainFilename.length > 0) {
    preferredMain = normalizeFilename(code.mainFilename)
  }
  if (!preferredMain) {
    const flagged = files.find((file) => file.isMain)
    if (flagged) preferredMain = flagged.filename
  }
  if (!preferredMain) {
    preferredMain = files[0]!.filename
  }

  const mainIndex = files.findIndex((file) => file.filename === preferredMain)
  if (mainIndex > 0) {
    files.unshift(files.splice(mainIndex, 1)[0]!)
  }

  const panels: MultiCodeTab[] = files.map((file) => {
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
