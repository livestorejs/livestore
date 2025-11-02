import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
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

/** Render a single SVG with the specified theme */
const renderSvgWithTheme = async (tldrPath: string, theme: TldrawTheme, tempDir: string): Promise<RenderedSvg> => {
  const isDark = theme === 'dark'

  /* Create a theme-specific subdirectory to avoid filename conflicts */
  const themeDir = path.join(tempDir, theme)
  await fs.mkdir(themeDir, { recursive: true })

  /* Ensure Puppeteer uses Playwright's Chromium when available (avoids downloads in CI) */
  ensurePuppeteerExecutableEnv()

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

/* Try to resolve a Chromium executable from Playwright's browser bundle and set Puppeteer env */
const ensurePuppeteerExecutableEnv = (): void => {
  if (!process.env.PUPPETEER_SKIP_DOWNLOAD) {
    process.env.PUPPETEER_SKIP_DOWNLOAD = '1'
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH && process.env.PUPPETEER_EXECUTABLE_PATH !== '') {
    return
  }

  // 1) Prefer Playwright-provided browsers via env
  const pwBase = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (pwBase && pwBase !== '') {
    for (const candidate of resolvePlaywrightChromiumCandidates(pwBase)) {
      if (fsSync.existsSync(candidate)) {
        process.env.PUPPETEER_EXECUTABLE_PATH = candidate
        return
      }
    }
  }

  // 2) Fall back to default Playwright cache directory
  for (const dir of resolveMsPlaywrightRoots()) {
    for (const candidate of resolvePlaywrightChromiumCandidates(dir)) {
      if (fsSync.existsSync(candidate)) {
        process.env.PUPPETEER_EXECUTABLE_PATH = candidate
        return
      }
    }
  }

  // 3) Last resort: common system Chrome locations (mainly Linux CI)
  for (const candidate of resolveSystemChromeCandidates()) {
    if (fsSync.existsSync(candidate)) {
      process.env.PUPPETEER_EXECUTABLE_PATH = candidate
      return
    }
  }
}

const resolvePlaywrightChromiumCandidates = (root: string): readonly string[] => {
  const entries: string[] = []

  /* Collect chromium-* directories, prefer higher revisions first */
  let chromiumDirs: string[] = []
  try {
    chromiumDirs = fsSync
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('chromium-'))
      .map((d) => d.name)
      .sort()
      .reverse()
  } catch {
    chromiumDirs = []
  }

  const platform = process.platform
  for (const dir of chromiumDirs) {
    if (platform === 'darwin') {
      entries.push(path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
    } else if (platform === 'linux') {
      entries.push(path.join(root, dir, 'chrome-linux', 'chrome'))
    } else if (platform === 'win32') {
      entries.push(path.join(root, dir, 'chrome-win', 'chrome.exe'))
    }
  }

  return entries
}

const resolveMsPlaywrightRoots = (): readonly string[] => {
  const roots: string[] = []
  const home = os.homedir()
  if (process.platform === 'linux') {
    const xdg = process.env.XDG_CACHE_HOME
    roots.push(path.join(xdg && xdg !== '' ? xdg : path.join(home, '.cache'), 'ms-playwright'))
  } else if (process.platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Caches', 'ms-playwright'))
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local && local !== '') roots.push(path.join(local, 'ms-playwright'))
  }
  return roots
}

const resolveSystemChromeCandidates = (): readonly string[] => {
  if (process.platform === 'linux') {
    return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  if (process.platform === 'win32') {
    const progFiles = process.env.PROGRAMFILES ?? 'C\\Program Files'
    const progFilesx86 = process.env['PROGRAMFILES(X86)'] ?? 'C\\Program Files (x86)'
    return [
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
  }
  return []
}
