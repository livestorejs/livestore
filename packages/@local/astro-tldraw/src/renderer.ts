import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tldrawToImage } from '@kitschpatrol/tldraw-cli'
import { shouldNeverHappen } from '@livestore/utils'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

export type TldrawTheme = 'light' | 'dark'

export interface RenderedSvg {
  svg: string
  theme: TldrawTheme
  contentHash: string
}

export interface RenderResult {
  lightSvg: string
  darkSvg: string
  sourceHash: string
  timestamp: string
}

/** Read and hash the .tldr file content */
export const readTldrawFile = async (filePath: string): Promise<{ content: string; hash: string }> => {
  const content = await fs.readFile(filePath, 'utf-8')
  const hash = hashString(content)
  return { content, hash }
}

// NOTE: We rely on the parent process to set PUPPETEER_EXECUTABLE_PATH before
// this module is imported. See scripts/src/commands/docs.ts where we derive it
// from PLAYWRIGHT_BROWSERS_PATH for CI/dev.

/** Render a single SVG with the specified theme */
const renderSvgWithTheme = async (tldrPath: string, theme: TldrawTheme, tempDir: string): Promise<RenderedSvg> => {
  const isDark = theme === 'dark'

  /* Create a theme-specific subdirectory to avoid filename conflicts */
  const themeDir = path.join(tempDir, theme)
  await fs.mkdir(themeDir, { recursive: true })

  /* Export to theme-specific directory */
  const outputPaths = await tldrawToImage(tldrPath, {
    format: 'svg',
    output: themeDir,
    dark: isDark,
    transparent: true,
    stripStyle: false,
  })

  if (outputPaths.length === 0) {
    return shouldNeverHappen(`No SVG generated for ${tldrPath}`)
  }

  /* Read the generated SVG */
  const svgPath = outputPaths[0]
  if (!svgPath) {
    return shouldNeverHappen(`SVG path is undefined for ${tldrPath}`)
  }

  const svg = await fs.readFile(svgPath, 'utf-8')
  const contentHash = hashString(svg)

  /* Clean up temp file */
  await fs.unlink(svgPath)

  return {
    svg,
    theme,
    contentHash,
  }
}

/** Render both light and dark SVGs from a .tldr file */
export const renderTldrawToSvg = async (tldrPath: string, tempDir: string): Promise<RenderResult> => {
  /* Ensure temp directory exists */
  await fs.mkdir(tempDir, { recursive: true })

  /* Read source file for hashing */
  const { hash: sourceHash } = await readTldrawFile(tldrPath)

  /* Render both themes */
  const [lightResult, darkResult] = await Promise.all([
    renderSvgWithTheme(tldrPath, 'light', tempDir),
    renderSvgWithTheme(tldrPath, 'dark', tempDir),
  ])

  return {
    lightSvg: lightResult.svg,
    darkSvg: darkResult.svg,
    sourceHash,
    timestamp: new Date().toISOString(),
  }
}

/** Get dimensions from SVG string */
export const getSvgDimensions = (
  svg: string,
): { width: number | undefined; height: number | undefined } | undefined => {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/)
  if (viewBoxMatch?.[1]) {
    const [, , width, height] = viewBoxMatch[1].split(' ').map(Number)
    return { width, height }
  }

  const widthMatch = svg.match(/width="([^"]+)"/)
  const heightMatch = svg.match(/height="([^"]+)"/)

  if (widthMatch?.[1] && heightMatch?.[1]) {
    return {
      width: Number.parseFloat(widthMatch[1]),
      height: Number.parseFloat(heightMatch[1]),
    }
  }

  return undefined
}
