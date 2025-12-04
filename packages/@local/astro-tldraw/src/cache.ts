import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { RenderResult } from './renderer.ts'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

export interface DiagramCacheEntry {
  /** Relative path from diagrams root (e.g., "architecture.tldr") */
  entryFile: string
  /** Path to cached artifact relative to cache root */
  artifactPath: string
  /** Hash of source .tldr file */
  sourceHash: string
  /** Hash of light SVG content */
  lightSvgHash: string
  /** Hash of dark SVG content */
  darkSvgHash: string
  /** ISO timestamp of when this was generated */
  generatedAt: string
}

export interface DiagramManifest {
  entries: DiagramCacheEntry[]
  version: string
}

export interface CachedDiagram {
  lightSvg: string
  darkSvg: string
  sourceHash: string
  generatedAt: string
  metadata: {
    width?: number
    height?: number
  }
}

const MANIFEST_FILENAME = 'manifest.json'
const CACHE_VERSION = '1.0.0'

/** Paths for tldraw diagram caching */
export interface TldrawCachePaths {
  /** Root directory for all cache data (e.g., docs/node_modules/.astro-tldraw) */
  cacheRoot: string
  /** Path to manifest.json */
  manifestPath: string
  /** Root directory containing .tldr source files */
  diagramsRoot: string
}

export const resolveCachePaths = (projectRoot: string): TldrawCachePaths => {
  const cacheRoot = path.join(projectRoot, 'node_modules', '.astro-tldraw')
  const manifestPath = path.join(cacheRoot, MANIFEST_FILENAME)
  const diagramsRoot = path.join(projectRoot, 'src', 'content', '_assets', 'diagrams')

  return {
    cacheRoot,
    manifestPath,
    diagramsRoot,
  }
}

/** Load existing manifest or return empty one */
export const loadManifest = async (manifestPath: string): Promise<DiagramManifest> => {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    const manifest = JSON.parse(content) as DiagramManifest
    return manifest
  } catch {
    return {
      entries: [],
      version: CACHE_VERSION,
    }
  }
}

/** Save manifest to disk */
export const saveManifest = async (manifestPath: string, manifest: DiagramManifest): Promise<void> => {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

/** Get cache entry for a specific diagram */
export const getCacheEntry = (manifest: DiagramManifest, entryFile: string): DiagramCacheEntry | undefined =>
  manifest.entries.find((entry) => entry.entryFile === entryFile)

/** Check if cached diagram is still valid */
export const isCacheValid = (entry: DiagramCacheEntry | undefined, currentSourceHash: string): boolean => {
  if (!entry) return false
  return entry.sourceHash === currentSourceHash
}

/** Generate artifact path for a diagram, preserving directory structure */
const getArtifactPath = (entryFile: string): string => {
  /* Remove .tldr extension and preserve relative path to ensure uniqueness */
  const withoutExt = entryFile.replace(/\.tldr$/, '')
  return path.join(withoutExt, 'diagram.json')
}

/** Save rendered diagram to cache */
export const saveDiagramToCache = async (
  paths: TldrawCachePaths,
  entryFile: string,
  renderResult: RenderResult,
  metadata?: { width?: number; height?: number },
): Promise<DiagramCacheEntry> => {
  const artifactPath = getArtifactPath(entryFile)
  const fullArtifactPath = path.join(paths.cacheRoot, artifactPath)

  /* Ensure directory exists */
  await fs.mkdir(path.dirname(fullArtifactPath), { recursive: true })

  /* Prepare cached diagram data */
  const cachedDiagram: CachedDiagram = {
    lightSvg: renderResult.lightSvg,
    darkSvg: renderResult.darkSvg,
    sourceHash: renderResult.sourceHash,
    generatedAt: renderResult.timestamp,
    metadata: metadata ?? {},
  }

  /* Write to disk */
  await fs.writeFile(fullArtifactPath, JSON.stringify(cachedDiagram, null, 2), 'utf-8')

  /* Create cache entry */
  const entry: DiagramCacheEntry = {
    entryFile,
    artifactPath,
    sourceHash: renderResult.sourceHash,
    lightSvgHash: hashString(renderResult.lightSvg),
    darkSvgHash: hashString(renderResult.darkSvg),
    generatedAt: renderResult.timestamp,
  }

  return entry
}

/** Load cached diagram from disk */
export const loadCachedDiagram = async (paths: TldrawCachePaths, entry: DiagramCacheEntry): Promise<CachedDiagram> => {
  const fullArtifactPath = path.join(paths.cacheRoot, entry.artifactPath)
  const content = await fs.readFile(fullArtifactPath, 'utf-8')
  return JSON.parse(content) as CachedDiagram
}

/** Update manifest with new/updated entry */
export const updateManifestEntry = (manifest: DiagramManifest, entry: DiagramCacheEntry): DiagramManifest => {
  const existingIndex = manifest.entries.findIndex((e) => e.entryFile === entry.entryFile)

  if (existingIndex >= 0) {
    /* Update existing entry */
    const updatedEntries = [...manifest.entries]
    updatedEntries[existingIndex] = entry
    return {
      ...manifest,
      entries: updatedEntries,
    }
  }

  /* Add new entry */
  return {
    ...manifest,
    entries: [...manifest.entries, entry],
  }
}
