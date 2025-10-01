import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'
import * as ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolveProjectPaths } from '../project-paths.ts'
import { buildSnippetBundle } from '../vite/snippet-graph.ts'
import { __internal, buildSnippets } from './snippets.ts'

type TTwoslasher = (
  code: string,
  lang: string,
  options: {
    vfsRoot?: string
    compilerOptions?: ts.CompilerOptions
    tsModule?: typeof ts
    tsLibDirectory?: string
  },
) => {
  errors: Array<{ renderedMessage: string }>
}

const fixturesRoot = fileURLToPath(new URL('./test-fixtures/catalog', import.meta.url))
const snippetRoot = fixturesRoot
const tsconfigPath = path.join(fixturesRoot, 'tsconfig.json')
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const workspaceRoot = process.env.WORKSPACE_ROOT ?? path.resolve(packageRoot, '../../..')
const exampleProjectRoot = path.join(packageRoot, 'example')
let twoslasher: TTwoslasher
type TRenderer = Parameters<typeof __internal.renderSnippet>[0]
let exampleRenderer: TRenderer
let examplePaths: ReturnType<typeof resolveProjectPaths>
let docsRenderer: TRenderer
let docsPaths: ReturnType<typeof resolveProjectPaths>

beforeAll(async () => {
  const modulePath = path.join(
    workspaceRoot,
    'node_modules/.pnpm/twoslash@0.2.12_typescript@5.9.2/node_modules/twoslash/dist/index.mjs',
  )
  const module = await import(pathToFileURL(modulePath).href)
  twoslasher = module.twoslasher as TTwoslasher

  examplePaths = resolveProjectPaths(exampleProjectRoot)
  const rendererResult = await Effect.runPromise(__internal.loadEcRenderer(examplePaths, {}))
  exampleRenderer = rendererResult.renderer

  const docsProjectRoot = path.join(workspaceRoot, 'docs')
  docsPaths = resolveProjectPaths(docsProjectRoot)
  const docsRendererResult = await Effect.runPromise(__internal.loadEcRenderer(docsPaths, {}))
  docsRenderer = docsRendererResult.renderer
})

const runExampleBuild = () =>
  buildSnippets({ projectRoot: exampleProjectRoot }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer))

const loadCompilerOptions = () => {
  const configSource = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configSource.error) {
    const message = ts.flattenDiagnosticMessageText(configSource.error.messageText, '\n')
    throw new Error(`Unable to read test fixture tsconfig: ${message}`)
  }

  const parsed = ts.parseJsonConfigFileContent(
    configSource.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  )

  const {
    incremental: _incremental,
    composite: _composite,
    tsBuildInfoFile: _tsBuildInfoFile,
    ...options
  } = parsed.options

  return {
    ...options,
    noEmit: true,
  }
}
const runTwoslashOnFixture = (entryRelativePath: string) => {
  const entryFilePath = path.join(snippetRoot, entryRelativePath)
  const bundle = buildSnippetBundle({ entryFilePath, baseDir: snippetRoot })
  const virtualFiles = __internal.createVirtualFiles(bundle.files, bundle.fileOrder)
  const focusVirtualPath = __internal.resolveFocusVirtualPath(virtualFiles, bundle.mainFileRelativePath)
  const assembled = __internal.assembleSnippet(
    virtualFiles.map((file) => ({ virtualPath: file.virtualPath, content: file.content })),
    focusVirtualPath,
  )
  const compilerOptions = loadCompilerOptions()
  const tsLibDirectory = path.dirname(ts.getDefaultLibFilePath(compilerOptions))

  return twoslasher(assembled.code, __internal.guessLanguage(entryRelativePath, 'ts'), {
    vfsRoot: snippetRoot,
    tsModule: ts,
    tsLibDirectory,
    compilerOptions,
  })
}

describe('Twoslash renderer fixtures', () => {
  it('successfully renders a basic bundle with local imports', async () => {
    const result = runTwoslashOnFixture('basic/store.ts')
    expect(result.errors).toHaveLength(0)
  })

  it('handles worker query imports present in docs snippets', async () => {
    const result = runTwoslashOnFixture('worker-loader/app/store.ts')
    expect(result.errors).toHaveLength(0)
  })

  it('resolves canonical LiveStore schema pattern without TypeScript diagnostics', () => {
    const result = runTwoslashOnFixture('reference/solid-integration/app.tsx')
    expect(result.errors.map((error) => error.renderedMessage)).toEqual([])
  })
})

describe('buildSnippets manifests', () => {
  it('reuses cached artefacts when inputs are unchanged', async () => {
    fs.rmSync(examplePaths.cacheRoot, { recursive: true, force: true })

    const firstRendered = await Effect.runPromise(runExampleBuild())
    expect(firstRendered).toBeGreaterThan(0)

    const warmRendered = await Effect.runPromise(runExampleBuild())
    expect(warmRendered).toBe(0)
  })
})

describe('renderSnippet integration', () => {
  it('emits isolated HTML for each file in a multi-file snippet', async () => {
    const entryFilePath = path.join(examplePaths.snippetAssetsRoot, 'main.ts')
    const bundle = buildSnippetBundle({ entryFilePath, baseDir: examplePaths.snippetAssetsRoot })

    const renderFile = async (filename: string) =>
      Effect.runPromise(__internal.renderSnippet(exampleRenderer, bundle, filename))

    const renderedMain = await renderFile('main.ts')
    const renderedUtils = await renderFile('utils.ts')

    const mainHtml = renderedMain.html ?? ''
    const utilsHtml = renderedUtils.html ?? ''
    const removeMarkup = (input: string) =>
      input
        .replace(/<div class="twoslash-popup-container[^"]*"[\s\S]*?<\/div>/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[#0-9a-zA-Z]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const mainText = removeMarkup(mainHtml)
    const utilsText = removeMarkup(utilsHtml)

    expect(mainText).toMatch(/export const\s+message/)
    expect(mainText).not.toMatch(/export const\s+greet\s*=\s*\(\s*name/)
    expect(utilsText).toMatch(/export const\s+greet\s*=\s*\(\s*name\s*:\s*string/)
    expect(utilsText).not.toMatch(/export const\s+message/)
    expect(mainHtml).not.toMatch(/__LS_FILE_(START|END)__/)
    expect(utilsHtml).not.toMatch(/__LS_FILE_(START|END)__/)
    expect(mainHtml).not.toContain('// @filename:')
    expect(utilsHtml).not.toContain('// @filename:')
    expect(mainHtml).not.toEqual(utilsHtml)

    const extractDataCode = (html: string): string => {
      const match = html.match(/data-code="([^"]*)"/)
      return match?.[1] ?? ''
    }
    const decodeDataCode = (value: string): string => value.replace(/\u007f/g, '\n')

    const mainDataCode = extractDataCode(mainHtml)
    const utilsDataCode = extractDataCode(utilsHtml)
    const decodedMainDataCode = decodeDataCode(mainDataCode)

    expect(mainDataCode).toContain('message')
    expect(decodedMainDataCode).toContain('\n\nexport const message')
    expect(mainDataCode).not.toMatch(/__LS_FILE_(START|END)__/)
    expect(utilsDataCode).toContain('greet = (name: string)')
    expect(utilsDataCode).not.toMatch(/__LS_FILE_(START|END)__/)
  })

  it('trims trailing blank lines from snippet payloads', async () => {
    const entryFilePath = path.join(examplePaths.snippetAssetsRoot, 'main.ts')
    const bundle = buildSnippetBundle({ entryFilePath, baseDir: examplePaths.snippetAssetsRoot })
    const mainRecord = bundle.files[bundle.mainFileRelativePath]
    if (!mainRecord) {
      throw new Error(`Missing main file record for ${bundle.mainFileRelativePath}`)
    }

    const paddedFiles: typeof bundle.files = {
      ...bundle.files,
      [bundle.mainFileRelativePath]: {
        ...mainRecord,
        content: `${mainRecord.content}\n\n`,
      },
    }

    const paddedBundle = {
      ...bundle,
      files: paddedFiles,
    }

    const rendered = await Effect.runPromise(
      __internal.renderSnippet(exampleRenderer, paddedBundle, bundle.mainFileRelativePath),
    )

    const dataCode = rendered.html?.match(/data-code="([^"]*)"/)?.[1] ?? ''
    const decoded = dataCode.replace(/\u007f/g, '\n')
    // biome-ignore lint/complexity/noUselessEscapeInRegex: readability when matching Expressive Code markup
    const blankLines = rendered.html?.match(/<div class=\"ec-line\"><div class=\"code\">\n<\/div><\/div>/g) ?? []

    expect(decoded).toContain('\n\nexport const message')
    expect(decoded.endsWith('\n')).toBe(false)
    expect(blankLines.length).toBe(1)
  })

  it('anchors tooltip helpers to document.body', () => {
    const tooltipModule = exampleRenderer.jsModules.find((code) => code.includes('function setupTooltip'))
    const moduleCode = tooltipModule ?? shouldNeverHappen('Tooltip helper module was not emitted')

    expect(moduleCode).toContain('t=document.body')
    expect(moduleCode).not.toContain('closest(".expressive-code")')
    expect(moduleCode).not.toContain('window.scroll')
    expect(moduleCode).toContain('if(!s)return;')
    expect(moduleCode).toContain('s.style.position="absolute"')
  })

  it('retains focus boundaries when snippets use cut markers', async () => {
    const entryFilePath = path.join(
      docsPaths.snippetAssetsRoot,
      'reference/platform-adapters/node-adapter/worker-main.ts',
    )
    const bundle = buildSnippetBundle({ entryFilePath, baseDir: docsPaths.snippetAssetsRoot })

    const rendered = await Effect.runPromise(
      __internal.renderSnippet(docsRenderer, bundle, 'reference/platform-adapters/node-adapter/worker-main.ts'),
    )

    const html = rendered.html ?? ''
    expect(html).toContain('const adapter = makeWorkerAdapter')
    expect(html).not.toMatch(/__LS_FILE_(START|END)__/)
    expect(html).not.toContain('// ---cut---')

    const dataCodeMatch = html.match(/data-code="([^"]*)"/)
    const dataCode = dataCodeMatch?.[1] ?? ''
    expect(dataCode).toContain('const adapter = makeWorkerAdapter')
    expect(dataCode).not.toMatch(/__LS_FILE_(START|END)__/)
  })
})

describe('buildSnippets cache reuse', () => {
  const cacheRoot = path.join(exampleProjectRoot, 'node_modules', '.astro-twoslash-code')

  const runBuild = () =>
    Effect.runPromise(
      buildSnippets({ projectRoot: exampleProjectRoot }).pipe(Effect.provide(PlatformNode.NodeFileSystem.layer)),
    )

  beforeAll(async () => {
    fs.rmSync(cacheRoot, { recursive: true, force: true })
  })

  it('skips rendering when artefacts are fresh', async () => {
    const firstRunCount = await runBuild()
    expect(firstRunCount).toBeGreaterThan(0)

    const secondRunCount = await runBuild()
    expect(secondRunCount).toBe(0)
  })
})
