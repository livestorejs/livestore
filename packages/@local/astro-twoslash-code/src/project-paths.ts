import path from 'node:path'

export type TwoslashProjectPaths = {
  projectRoot: string
  srcRoot: string
  snippetAssetsRoot: string
  cacheRoot: string
  manifestPath: string
  ecConfigPath: string
}

export const resolveProjectPaths = (projectRootInput: string): TwoslashProjectPaths => {
  const projectRoot = path.resolve(projectRootInput)
  const srcRoot = path.join(projectRoot, 'src')
  const snippetAssetsRoot = path.join(srcRoot, 'content', '_assets', 'code')
  const cacheRoot = path.join(projectRoot, '.cache', 'snippets')
  const manifestPath = path.join(cacheRoot, 'manifest.json')
  const ecConfigPath = path.join(projectRoot, 'ec.config.mjs')

  return {
    projectRoot,
    srcRoot,
    snippetAssetsRoot,
    cacheRoot,
    manifestPath,
    ecConfigPath,
  }
}

export const defaultRebuildCommand = 'mono docs snippets build'

export const formatRebuildInstruction = (command: string): string => `Run "${command}" to regenerate snippet artefacts.`
