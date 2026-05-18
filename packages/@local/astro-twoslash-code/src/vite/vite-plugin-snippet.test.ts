import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createExpressiveCodeConfig } from '../expressive-code.ts'
import { resolveProjectPaths } from '../project-paths.ts'
import { createTwoslashSnippetPlugin } from './vite-plugin-snippet.ts'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

type FixtureContext = {
  projectRoot: string
  entryFilePath: string
  expectedPayload: unknown
  cleanup: () => void
}

const createFixtureProject = (): FixtureContext => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'twoslash-plugin-'))
  const snippetDir = path.join(projectRoot, 'src', 'content', '_assets', 'code')
  const cacheDir = path.join(projectRoot, 'node_modules', '.astro-twoslash-code')

  fs.mkdirSync(snippetDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })

  const tsconfigPath = path.join(snippetDir, 'tsconfig.json')
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          strict: true,
        },
      },
      null,
      2,
    ),
  )

  const entryContent = `export const greet = (name: string): string => \`Hello, \${name}!\`\n`
  const entryFilePath = path.join(snippetDir, 'main.ts')
  fs.writeFileSync(entryFilePath, entryContent)

  const hash = sha256(entryContent)
  const artefact = {
    mainFilename: 'main.ts',
    generatedAt: '2025-10-01T00:00:00.000Z',
    bundleHash: 'bundle-hash',
    fileOrder: ['main.ts'],
    files: {
      'main.ts': {
        content: entryContent,
        isMain: true,
        hash,
      },
    },
    rendered: {
      'main.ts': {
        html: '<div class="expressive-code"></div>',
        language: 'ts',
        meta: 'twoslash',
        diagnostics: [],
        styles: [],
      },
    },
  }
  fs.writeFileSync(path.join(cacheDir, 'main.ts.json'), JSON.stringify(artefact))

  const paths = resolveProjectPaths(projectRoot)
  const { fingerprintHash } = createExpressiveCodeConfig(paths, {})

  const manifest = {
    entries: [
      {
        entryFile: 'main.ts',
        artifactPath: 'main.ts.json',
        bundleHash: 'bundle-hash',
      },
    ],
    baseStyles: '.expressive-code { display: block; }',
    themeStyles: '',
    jsModules: ['export const init = () => {};'],
    configHash: fingerprintHash,
  }
  fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify(manifest))

  const expectedPayload = {
    files: artefact.files,
    fileOrder: artefact.fileOrder,
    mainFilename: 'main.ts',
    rendered: artefact.rendered,
    globals: {
      baseStyles: manifest.baseStyles,
      themeStyles: manifest.themeStyles,
      jsModules: manifest.jsModules,
    },
    bundleHash: artefact.bundleHash,
    generatedAt: artefact.generatedAt,
  }

  const cleanup = () => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }

  return { projectRoot, entryFilePath, expectedPayload, cleanup }
}

const createMultiFileFixtureProject = (): FixtureContext => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'twoslash-plugin-multi-'))
  const snippetDir = path.join(projectRoot, 'src', 'content', '_assets', 'code')
  const cacheDir = path.join(projectRoot, 'node_modules', '.astro-twoslash-code')

  fs.mkdirSync(snippetDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })

  const tsconfigPath = path.join(snippetDir, 'tsconfig.json')
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          strict: true,
        },
      },
      null,
      2,
    ),
  )

  const mainContent = `import { greet } from './utils.ts'\n\nexport const message = greet('Livestore')\n`
  const utilsContent = `export const greet = (name: string): string => name.toUpperCase()\n`
  const entryFilePath = path.join(snippetDir, 'main.ts')
  fs.writeFileSync(entryFilePath, mainContent)
  fs.writeFileSync(path.join(snippetDir, 'utils.ts'), utilsContent)

  const artefact = {
    mainFilename: 'main.ts',
    generatedAt: '2025-10-01T00:00:00.000Z',
    bundleHash: 'multi-bundle-hash',
    fileOrder: ['main.ts', 'utils.ts'],
    files: {
      'main.ts': {
        content: mainContent,
        isMain: true,
        hash: sha256(mainContent),
      },
      'utils.ts': {
        content: utilsContent,
        isMain: false,
        hash: sha256(utilsContent),
      },
    },
    rendered: {
      'main.ts': {
        html: '<div class="expressive-code"><pre><code>// main.ts only</code></pre></div>',
        language: 'ts',
        meta: 'twoslash',
        diagnostics: [],
        styles: [],
      },
      'utils.ts': {
        html: '<div class="expressive-code"><pre><code>// utils.ts only</code></pre></div>',
        language: 'ts',
        meta: 'twoslash',
        diagnostics: [],
        styles: [],
      },
    },
  }
  fs.writeFileSync(path.join(cacheDir, 'main.ts.json'), JSON.stringify(artefact))

  const paths = resolveProjectPaths(projectRoot)
  const { fingerprintHash } = createExpressiveCodeConfig(paths, {})

  const manifest = {
    entries: [
      {
        entryFile: 'main.ts',
        artifactPath: 'main.ts.json',
        bundleHash: 'multi-bundle-hash',
      },
    ],
    baseStyles: '',
    themeStyles: '',
    jsModules: [],
    configHash: fingerprintHash,
  }
  fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify(manifest))

  const expectedPayload = {
    files: artefact.files,
    fileOrder: artefact.fileOrder,
    mainFilename: 'main.ts',
    rendered: artefact.rendered,
    globals: {
      baseStyles: manifest.baseStyles,
      themeStyles: manifest.themeStyles,
      jsModules: manifest.jsModules,
    },
    bundleHash: artefact.bundleHash,
    generatedAt: artefact.generatedAt,
  }

  const cleanup = () => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }

  return { projectRoot, entryFilePath, expectedPayload, cleanup }
}

describe('createTwoslashSnippetPlugin', () => {
  it('emits the raw payload when requesting ?snippet-raw', () => {
    const { projectRoot, entryFilePath, expectedPayload, cleanup } = createFixtureProject()
    try {
      const plugin = createTwoslashSnippetPlugin({ projectRoot })
      plugin.buildStart?.()
      const result = plugin.transform('', `${entryFilePath}?snippet-raw`)
      expect(result).not.toBeNull()
      const rawPrefix = 'export default '
      expect(result!.code.startsWith(rawPrefix)).toBe(true)
      const parsed = JSON.parse(result!.code.slice(rawPrefix.length).trim())
      expect(parsed).toStrictEqual(expectedPayload)
    } finally {
      cleanup()
    }
  })

  it('wraps the payload in a component when requesting ?snippet', () => {
    const { projectRoot, entryFilePath, expectedPayload, cleanup } = createFixtureProject()
    try {
      const plugin = createTwoslashSnippetPlugin({ projectRoot })
      plugin.buildStart?.()
      const result = plugin.transform('', `${entryFilePath}?snippet`)
      expect(result).not.toBeNull()

      const code = result!.code
      expect(code).toContain('import MultiCode from "/@fs')
      expect(code).toContain('MultiCode.astro"')
      expect(code).toContain('export const snippetData = ')
      expect(code).toContain('const Component = (result, props, slots) => MultiCode(')
      expect(code).toContain('Component.isAstroComponentFactory = MultiCode.isAstroComponentFactory === true')
      expect(code).toContain('if (typeof MultiCode.moduleId === "string") Component.moduleId = MultiCode.moduleId')

      const marker = 'export const snippetData = '
      const markerIndex = code.indexOf(marker)
      expect(markerIndex).toBeGreaterThan(-1)
      const afterMarker = code.slice(markerIndex + marker.length)
      const jsonLiteral = afterMarker.split('\n', 1)[0]?.trim()
      expect(jsonLiteral).toBeTruthy()
      const parsed = JSON.parse(jsonLiteral!)
      expect(parsed).toStrictEqual(expectedPayload)
    } finally {
      cleanup()
    }
  })

  it('preserves multi-file rendered artefacts as keyed records', () => {
    const { projectRoot, entryFilePath, expectedPayload, cleanup } = createMultiFileFixtureProject()
    try {
      const plugin = createTwoslashSnippetPlugin({ projectRoot })
      plugin.buildStart?.()
      const result = plugin.transform('', `${entryFilePath}?snippet-raw`)
      expect(result).not.toBeNull()
      const rawPrefix = 'export default '
      expect(result!.code.startsWith(rawPrefix)).toBe(true)
      const parsed = JSON.parse(result!.code.slice(rawPrefix.length).trim())
      expect(Array.isArray(parsed.rendered)).toBe(false)
      expect(Object.keys(parsed.rendered)).toEqual(['main.ts', 'utils.ts'])
      expect(parsed).toStrictEqual(expectedPayload)
    } finally {
      cleanup()
    }
  })

  it('throws when the manifest config hash does not match the current configuration', () => {
    const { projectRoot, entryFilePath, cleanup } = createFixtureProject()
    try {
      const manifestPath = path.join(projectRoot, 'node_modules', '.astro-twoslash-code', 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      manifest.configHash = 'outdated'
      fs.writeFileSync(manifestPath, JSON.stringify(manifest))

      const plugin = createTwoslashSnippetPlugin({ projectRoot })
      plugin.buildStart?.()

      expect(() => plugin.transform('', `${entryFilePath}?snippet-raw`)).toThrow(/Snippet manifest is stale/)
    } finally {
      cleanup()
    }
  })
})
