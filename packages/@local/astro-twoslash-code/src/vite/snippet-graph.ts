import fs from 'node:fs'
import path from 'node:path'

const importRegex = /(?:import|export)\s+(?:.*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g
const referenceRegex = /\/\/\/\s*<reference\s+path=["'](.+?)["']\s*\/>/g

const toPosix = (value: string): string => value.replace(/\\/g, '/')

const defaultExists = (filePath: string): boolean => fs.existsSync(filePath)
const defaultReadFile = (filePath: string): string => fs.readFileSync(filePath, 'utf-8')

const resolveBaseDir = (entryFilePath: string): string => {
  const resolved = path.resolve(entryFilePath)
  const entryDir = path.dirname(resolved)
  return path.dirname(entryDir)
}

const extractRelativeImports = (content: string): string[] => {
  const matches: string[] = []

  let importMatch = importRegex.exec(content)
  while (importMatch !== null) {
    const specifier = importMatch[1]
    if (typeof specifier === 'string') matches.push(specifier)
    importMatch = importRegex.exec(content)
  }

  let referenceMatch = referenceRegex.exec(content)
  while (referenceMatch !== null) {
    const specifier = referenceMatch[1]
    if (typeof specifier === 'string') matches.push(specifier)
    referenceMatch = referenceRegex.exec(content)
  }

  return matches
}

const resolveCandidatesFor = (specifier: string, fromDirectory: string): string[] => {
  const resolved = path.resolve(fromDirectory, specifier)
  const candidates = [resolved]

  if (!resolved.endsWith('.ts') && !resolved.endsWith('.tsx') && !resolved.endsWith('.d.ts')) {
    candidates.push(`${resolved}.ts`, `${resolved}.tsx`)
  }

  return candidates
}

export interface SnippetFileRecord {
  absolutePath: string
  relativePath: string
  content: string
  isMain: boolean
}

export interface SnippetBundle {
  baseDir: string
  entryFilePath: string
  mainFileRelativePath: string
  files: SnippetFileRecord[]
}

export interface BuildSnippetBundleOptions {
  entryFilePath: string
  baseDir?: string
  fileExists?: (filePath: string) => boolean
  readFile?: (filePath: string) => string
}

export const buildSnippetBundle = ({
  entryFilePath,
  baseDir = resolveBaseDir(entryFilePath),
  fileExists = defaultExists,
  readFile = defaultReadFile,
}: BuildSnippetBundleOptions): SnippetBundle => {
  if (entryFilePath.length === 0) {
    throw new Error('buildSnippetBundle: entryFilePath must be a non-empty string')
  }

  const absoluteEntry = path.resolve(entryFilePath)
  const resolvedBaseDir = path.resolve(baseDir)
  const queue: Array<{ absolutePath: string }> = [{ absolutePath: absoluteEntry }]
  const processed = new Set<string>()
  const collected = new Map<string, { absolutePath: string; relativePath: string; content: string }>()

  const addFile = (absolutePath: string) => {
    const relativePath = toPosix(path.relative(resolvedBaseDir, absolutePath))
    const existing = collected.get(relativePath)
    if (existing) return existing
    const content = readFile(absolutePath)
    const record = {
      absolutePath,
      relativePath,
      content,
    }
    collected.set(relativePath, record)
    return record
  }

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const { absolutePath } = current
    if (processed.has(absolutePath)) continue
    processed.add(absolutePath)

    if (!fileExists(absolutePath)) {
      continue
    }

    const record = addFile(absolutePath)
    if (!record) continue
    const { content } = record

    for (const specifier of extractRelativeImports(content)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      const candidates = resolveCandidatesFor(specifier, path.dirname(absolutePath))
      for (const candidate of candidates) {
        if (fileExists(candidate)) {
          queue.push({ absolutePath: candidate })
          break
        }
      }
    }
  }

  const files = Array.from(collected.values())

  files.sort((left, right) => {
    const leftIsDts = left.relativePath.endsWith('.d.ts')
    const rightIsDts = right.relativePath.endsWith('.d.ts')
    if (leftIsDts && !rightIsDts) return -1
    if (!leftIsDts && rightIsDts) return 1
    return left.relativePath.localeCompare(right.relativePath)
  })

  const mainRelativePath = toPosix(path.relative(resolvedBaseDir, absoluteEntry))
  const mainIndex = files.findIndex((file) => file.relativePath === mainRelativePath)
  if (mainIndex > 0) {
    files.unshift(files.splice(mainIndex, 1)[0]!)
  }

  return {
    baseDir: resolvedBaseDir,
    entryFilePath: absoluteEntry,
    mainFileRelativePath: mainRelativePath,
    files: files.map((file, index) => ({
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      content: file.content,
      isMain: index === 0,
    })),
  }
}

export const __internal = {
  extractRelativeImports,
  resolveCandidatesFor,
  resolveBaseDir,
}
