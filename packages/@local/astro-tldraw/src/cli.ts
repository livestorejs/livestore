import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getCacheEntry,
  isCacheValid,
  loadManifest,
  resolveCachePaths,
  saveDiagramToCache,
  saveManifest,
  updateManifestEntry,
} from './cache.ts'
import { getSvgDimensions, readTldrawFile, renderTldrawToSvg } from './renderer.ts'

export interface BuildDiagramsOptions {
  projectRoot: string
  verbose?: boolean
}

/** Discover all .tldr files in the diagrams directory recursively */
const discoverDiagramFiles = async (diagramsRoot: string): Promise<string[]> => {
  const results: string[] = []

  const walk = async (dir: string): Promise<void> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.tldr')) {
          results.push(fullPath)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }
  }

  await walk(diagramsRoot)
  return results
}

/** Build all diagrams, rendering to SVG and caching */
export const buildDiagrams = async (options: BuildDiagramsOptions): Promise<void> => {
  const { projectRoot, verbose = false } = options
  const paths = resolveCachePaths(projectRoot)

  if (verbose) {
    console.log('Building tldraw diagrams...')
    console.log(`  Diagrams root: ${paths.diagramsRoot}`)
    console.log(`  Cache root: ${paths.cacheRoot}`)
  }

  /* Discover all .tldr files */
  const diagramFiles = await discoverDiagramFiles(paths.diagramsRoot)

  if (diagramFiles.length === 0) {
    if (verbose) {
      console.log('  No .tldr files found')
    }
    /* Still save an empty manifest */
    await saveManifest(paths.manifestPath, { entries: [], version: '1.0.0' })
    return
  }

  if (verbose) {
    console.log(`  Found ${diagramFiles.length} diagram(s)`)
  }

  /* Load existing manifest */
  const manifest = await loadManifest(paths.manifestPath)

  /* Create temporary directory for rendering */
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tldraw-render-'))

  try {
    /* Process each diagram */
    let updatedManifest = manifest
    let renderedCount = 0
    let skippedCount = 0

    for (const diagramPath of diagramFiles) {
      const entryFile = path.relative(paths.diagramsRoot, diagramPath).replace(/\\/g, '/')

      /* Check if we need to re-render */
      const { hash: sourceHash } = await readTldrawFile(diagramPath)
      const existingEntry = getCacheEntry(manifest, entryFile)

      if (isCacheValid(existingEntry, sourceHash)) {
        if (verbose) {
          console.log(`  ✓ ${entryFile} (cached)`)
        }
        skippedCount++
        continue
      }

      if (verbose) {
        console.log(`  ⟳ ${entryFile} (rendering...)`)
      }

      /* Render to SVG */
      const renderResult = await renderTldrawToSvg(diagramPath, tempDir)

      /* Extract dimensions */
      const dimensions = getSvgDimensions(renderResult.lightSvg)

      /* Build metadata with proper type handling */
      const metadata:
        | {
            width?: number
            height?: number
          }
        | undefined =
        dimensions?.width !== undefined && dimensions?.height !== undefined
          ? { width: dimensions.width, height: dimensions.height }
          : dimensions?.width !== undefined
            ? { width: dimensions.width }
            : dimensions?.height !== undefined
              ? { height: dimensions.height }
              : undefined

      /* Save to cache */
      const entry = await saveDiagramToCache(paths, entryFile, renderResult, metadata)

      /* Update manifest */
      updatedManifest = updateManifestEntry(updatedManifest, entry)

      if (verbose) {
        console.log(`    ✓ ${entryFile}`)
      }
      renderedCount++
    }

    /* Save updated manifest */
    await saveManifest(paths.manifestPath, updatedManifest)

    if (verbose) {
      console.log(`\n  Summary:`)
      console.log(`    Rendered: ${renderedCount}`)
      console.log(`    Cached: ${skippedCount}`)
      console.log(`    Total: ${diagramFiles.length}`)
    }
  } finally {
    /* Clean up temp directory */
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
