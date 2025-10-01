import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { defineEcConfig } from 'astro-expressive-code'
import type { ExpressiveCodePlugin } from 'expressive-code'
import ecTwoslash from 'expressive-code-twoslash'
import * as ts from 'typescript'

import type { TwoslashProjectPaths } from './project-paths.ts'

const hashString = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

const stableStringify = (value: unknown): string => {
  if (value === null) return 'null'
  const valueType = typeof value
  if (valueType === 'number' || valueType === 'boolean') {
    return JSON.stringify(value)
  }
  if (valueType === 'string') {
    return JSON.stringify(value)
  }
  if (valueType === 'undefined') {
    return '"__undefined__"'
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  if (valueType === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`
  }

  throw new Error(`Unable to serialize value of type ${valueType}`)
}

export type ExpressiveCodePluginDescriptor = {
  signature: string
  plugin: ExpressiveCodePlugin
}

export type TwoslashRuntimeOptions = {
  snippetTsconfigPath?: string
  compilerOptions?: Partial<ts.CompilerOptions>
  extraPlugins?: readonly ExpressiveCodePluginDescriptor[]
}

export type ResolvedExpressiveCodeConfig = {
  config: ReturnType<typeof defineEcConfig>
  fingerprintHash: string
}

const resolveTsconfigPath = (paths: TwoslashProjectPaths, overridePath: string | undefined): string => {
  if (overridePath === undefined) {
    return path.join(paths.snippetAssetsRoot, 'tsconfig.json')
  }
  if (path.isAbsolute(overridePath)) {
    return overridePath
  }
  return path.resolve(paths.projectRoot, overridePath)
}

const ensureSnippetWorkspace = (snippetRoot: string): void => {
  if (!fs.existsSync(snippetRoot)) {
    throw new Error(`Unable to locate snippet workspace at ${snippetRoot}`)
  }
}

const parseSnippetTsconfig = (tsconfigPath: string): { source: string; options: ts.CompilerOptions } => {
  if (!fs.existsSync(tsconfigPath)) {
    throw new Error(`Snippet tsconfig not found at ${tsconfigPath}`)
  }

  const source = fs.readFileSync(tsconfigPath, 'utf8')
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')
    throw new Error(`Unable to read ${tsconfigPath}: ${message}`)
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  )

  return { source, options: parsed.options }
}

const mergeCompilerOptions = (
  base: ts.CompilerOptions,
  override: Partial<ts.CompilerOptions> | undefined,
): ts.CompilerOptions => {
  const merged: ts.CompilerOptions = {
    ...base,
    ...(override ?? {}),
    noEmit: true,
  }
  return merged
}

export const createExpressiveCodeConfig = (
  paths: TwoslashProjectPaths,
  options: TwoslashRuntimeOptions = {},
): ResolvedExpressiveCodeConfig => {
  const snippetRoot = paths.snippetAssetsRoot
  ensureSnippetWorkspace(snippetRoot)

  const snippetTsconfigPath = resolveTsconfigPath(paths, options.snippetTsconfigPath)
  const { source: tsconfigSource, options: baseCompilerOptions } = parseSnippetTsconfig(snippetTsconfigPath)
  const compilerOptions = mergeCompilerOptions(baseCompilerOptions, options.compilerOptions)

  const twoslashCache = new Map()
  const tsLibDirectory = path.dirname(ts.getDefaultLibFilePath(compilerOptions))

  const additionalPlugins = options.extraPlugins ?? []
  const pluginInstances: ExpressiveCodePlugin[] = [
    ecTwoslash({
      twoslashOptions: {
        vfsRoot: snippetRoot,
        cache: twoslashCache,
        tsModule: ts,
        tsLibDirectory,
        compilerOptions,
      },
    }),
    ...additionalPlugins.map((descriptor) => descriptor.plugin),
  ]

  const config = defineEcConfig({ plugins: pluginInstances })

  const fingerprintPayload = {
    snippetRoot,
    snippetTsconfigPath,
    snippetTsconfigHash: hashString(tsconfigSource),
    compilerOptions,
    pluginSignatures: additionalPlugins.map((descriptor) => descriptor.signature),
    typescriptVersion: ts.version,
  }

  const fingerprintHash = hashString(stableStringify(fingerprintPayload))

  return { config, fingerprintHash }
}

export const normalizeRuntimeOptions = (
  options: TwoslashRuntimeOptions | undefined = undefined,
): TwoslashRuntimeOptions => {
  const normalized: TwoslashRuntimeOptions = {}

  if (options?.snippetTsconfigPath !== undefined) {
    normalized.snippetTsconfigPath = options.snippetTsconfigPath
  }

  if (options?.compilerOptions !== undefined) {
    normalized.compilerOptions = { ...options.compilerOptions }
  }

  if (options?.extraPlugins !== undefined) {
    normalized.extraPlugins = options.extraPlugins.map((descriptor) => ({
      signature: descriptor.signature,
      plugin: descriptor.plugin,
    }))
  }

  return normalized
}
