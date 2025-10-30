import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldNeverHappen } from '@livestore/utils'
import { getCacheEntry, loadCachedDiagram, loadManifest, resolveCachePaths, type TldrawCachePaths } from './cache.ts'
import { getSvgDimensions } from './renderer.ts'

type MinimalVitePlugin = {
  name: string
  enforce?: 'pre' | 'post'
  configResolved?: (config: { root: string }) => void
  buildStart?: () => void
  transform: (code: string, id: string) => Promise<{ code: string; map: null }> | { code: string; map: null } | null
}

const TLDRAW_QUERY = 'tldraw'

export interface TldrawPluginOptions {
  projectRoot?: string
}

export interface TldrawDiagramPayload {
  lightSvg: string
  darkSvg: string
  metadata: {
    width?: number
    height?: number
  }
  sourceHash: string
  generatedAt: string
}

const diagramComponentSpecifier = (() => {
  const filePath = fileURLToPath(new URL('./components/TldrawDiagram.astro', import.meta.url))
  const normalized = filePath.replace(/\\/g, '/')
  return `/@fs${normalized}`
})()

const formatRebuildInstruction = (): string => 'Please run `mono docs diagrams build` to regenerate the cache.'

const createComponentModuleSource = (serializedPayload: string, componentSpecifier: string): string =>
  [
    `import TldrawDiagram from ${JSON.stringify(componentSpecifier)}`,
    '',
    `export const diagramData = ${serializedPayload}`,
    '',
    'const Component = (result, props, slots) => TldrawDiagram(result, { ...props, diagram: diagramData }, slots)',
    'Component.prototype = TldrawDiagram.prototype',
    'Component.isAstroComponentFactory = TldrawDiagram.isAstroComponentFactory === true',
    'if (typeof TldrawDiagram.moduleId === "string") Component.moduleId = TldrawDiagram.moduleId',
    'if (typeof TldrawDiagram.moduleSpecifier === "string") Component.moduleSpecifier = TldrawDiagram.moduleSpecifier',
    'if (typeof TldrawDiagram.propagation === "object" && TldrawDiagram.propagation !== null) Component.propagation = TldrawDiagram.propagation',
    'Object.defineProperty(Component, "name", { value: TldrawDiagram.name, configurable: true })',
    'for (const symbol of Object.getOwnPropertySymbols(TldrawDiagram)) {',
    '  Component[symbol] = TldrawDiagram[symbol]',
    '}',
    'export default Component',
    '',
  ].join('\n')

export const createTldrawPlugin = (options: TldrawPluginOptions = {}): MinimalVitePlugin => {
  let paths: TldrawCachePaths = options.projectRoot
    ? resolveCachePaths(options.projectRoot)
    : shouldNeverHappen('projectRoot is not set')
  let rebuildInstruction = formatRebuildInstruction()

  return {
    name: '@local/astro-tldraw/vite-plugin',
    enforce: 'pre',

    configResolved(config) {
      if (!options.projectRoot) {
        paths = resolveCachePaths(config.root)
      }
      rebuildInstruction = formatRebuildInstruction()
    },

    buildStart() {
      /* Clear any cached state on build start */
    },

    transform(_code, id) {
      const [filepath, rawQuery] = id.split('?')
      if (!filepath || !rawQuery) {
        return null
      }

      /* Check if this is a .tldr?tldraw import */
      if (!filepath.endsWith('.tldr') || !rawQuery.includes(TLDRAW_QUERY)) {
        return null
      }

      /* Load manifest and find cache entry */
      const manifestPromise = loadManifest(paths.manifestPath)

      return manifestPromise.then(async (manifest) => {
        /* Resolve filepath to absolute path if it's relative */
        const absoluteFilepath = path.isAbsolute(filepath) ? filepath : path.resolve(filepath)
        const entryRelative = path.relative(paths.diagramsRoot, absoluteFilepath).replace(/\\/g, '/')
        const entry = getCacheEntry(manifest, entryRelative)

        if (!entry) {
          throw new Error(`No cached diagram artifact for ${entryRelative}. ${rebuildInstruction}`)
        }

        /* Load cached diagram */
        const cached = await loadCachedDiagram(paths, entry)

        /* Extract dimensions from SVGs */
        const lightDimensions = getSvgDimensions(cached.lightSvg)
        const darkDimensions = getSvgDimensions(cached.darkSvg)

        /* Prepare payload */
        const width = lightDimensions?.width ?? darkDimensions?.width
        const height = lightDimensions?.height ?? darkDimensions?.height

        const payload: TldrawDiagramPayload = {
          lightSvg: cached.lightSvg,
          darkSvg: cached.darkSvg,
          metadata:
            width !== undefined && height !== undefined
              ? { width, height }
              : width !== undefined
                ? { width }
                : height !== undefined
                  ? { height }
                  : {},
          sourceHash: cached.sourceHash,
          generatedAt: cached.generatedAt,
        }

        const serializedPayload = JSON.stringify(payload)

        return {
          code: createComponentModuleSource(serializedPayload, diagramComponentSpecifier),
          map: null,
        }
      })
    },
  }
}
