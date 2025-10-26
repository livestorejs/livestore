import path from 'node:path'

export type TwoslashProjectPaths = {
  projectRoot: string
  srcRoot: string
  snippetAssetsRoot: string
  cacheRoot: string
  manifestPath: string
}

export const resolveProjectPaths = (projectRootInput: string): TwoslashProjectPaths => {
  const projectRoot = path.resolve(projectRootInput)
  const srcRoot = path.join(projectRoot, 'src')
  const snippetAssetsRoot = path.join(srcRoot, 'content', '_assets', 'code')
  const cacheRoot = path.join(projectRoot, 'node_modules', '.astro-twoslash-code')
  const manifestPath = path.join(cacheRoot, 'manifest.json')

  return {
    projectRoot,
    srcRoot,
    snippetAssetsRoot,
    cacheRoot,
    manifestPath,
  }
}

export const formatRebuildInstruction = (): string =>
  'Regenerate snippet artefacts using your docs snippet build command.'
