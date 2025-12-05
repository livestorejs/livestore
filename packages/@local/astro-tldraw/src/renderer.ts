import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tldrawToImage } from '@kitschpatrol/tldraw-cli'
import { shouldNeverHappen } from '@livestore/utils'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

const RENDER_TIMEOUT_MS = 30_000
const MAX_RETRIES = 3

/** Execute a promise with a timeout */
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs)),
  ])

/** Execute a function with retry logic */
const withRetry = async <T>(
  fn: () => Promise<T>,
  {
    maxRetries,
    delayMs,
    onRetry,
  }: { maxRetries: number; delayMs: number; onRetry?: (attempt: number, error: Error) => void },
): Promise<T> => {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < maxRetries) {
        onRetry?.(attempt, lastError)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastError
}

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

/** Render a single SVG with the specified theme (with timeout and retry) */
const renderSvgWithTheme = async (tldrPath: string, theme: TldrawTheme, tempDir: string): Promise<RenderedSvg> => {
  const isDark = theme === 'dark'
  const diagramName = path.basename(tldrPath)

  /* Create a theme-specific subdirectory to avoid filename conflicts */
  const themeDir = path.join(tempDir, theme)
  await fs.mkdir(themeDir, { recursive: true })

  /* Export to theme-specific directory with timeout and retry */
  const outputPaths = await withRetry<string[]>(
    () =>
      withTimeout(
        tldrawToImage(tldrPath, {
          format: 'svg',
          output: themeDir,
          dark: isDark,
          transparent: true,
          stripStyle: false,
        }),
        RENDER_TIMEOUT_MS,
        `Tldraw render timed out after ${RENDER_TIMEOUT_MS}ms for ${diagramName} (${theme})`,
      ),
    {
      maxRetries: MAX_RETRIES,
      delayMs: 1000,
      onRetry: (attempt, error) => {
        console.warn(`  ⚠ Retry ${attempt}/${MAX_RETRIES - 1} for ${diagramName} (${theme}): ${error.message}`)
      },
    },
  )

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
