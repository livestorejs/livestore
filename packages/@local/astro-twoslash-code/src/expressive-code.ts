import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { defineEcConfig } from 'astro-expressive-code'
import { definePlugin, type ExpressiveCodeBlock, type ExpressiveCodePlugin } from 'expressive-code'
import ecTwoslash from 'expressive-code-twoslash'
import type { Properties as HastProperties } from 'hast'
import * as ts from 'typescript'

import type { TwoslashProjectPaths } from './project-paths.ts'

export type LineOwnerMarker = 'start' | 'end'

export type LineOwnerMetadata = {
  owner: string | null
  marker: LineOwnerMarker | null
}

declare module 'expressive-code' {
  interface ExpressiveCodeBlockProps {
    /**
     * Livestore internal metadata describing who owns each rendered line.
     * The trimming stage uses this to drop supporting files and sentinels.
     */
    lsLineOwners?: readonly LineOwnerMetadata[]
  }
}

const lineMetadataByBlock = new WeakMap<ExpressiveCodeBlock, Array<LineOwnerMetadata | null>>()

const createLineOwnerPlugin = (): ExpressiveCodePlugin =>
  definePlugin({
    name: 'livestore-line-owner',
    hooks: {
      preprocessCode: ({ codeBlock }) => {
        const metadata = codeBlock.props.lsLineOwners
        if (!metadata || metadata.length === 0) {
          return
        }

        const lines = codeBlock.getLines()
        if (lines.length === 0 || metadata.length === 0) {
          return
        }

        const resolved: Array<LineOwnerMetadata | null> = []
        let pointer = 0
        const takeNextMatching = (predicate: (entry: LineOwnerMetadata) => boolean): LineOwnerMetadata | null => {
          while (pointer < metadata.length) {
            const candidate = metadata[pointer]!
            pointer += 1
            if (predicate(candidate)) {
              return candidate
            }
          }
          return null
        }

        for (const line of lines) {
          const trimmed = line.text.trim()

          if (trimmed.startsWith('// @filename:')) {
            takeNextMatching((entry) => entry.owner === null && entry.marker === null)
            resolved.push(null)
            continue
          }

          if (trimmed.startsWith('// __LS_FILE_START__')) {
            const entry = takeNextMatching((candidate) => candidate.marker === 'start')
            resolved.push(entry)
            continue
          }

          if (trimmed.startsWith('// __LS_FILE_END__')) {
            const entry = takeNextMatching((candidate) => candidate.marker === 'end')
            resolved.push(entry)
            continue
          }

          const entry = takeNextMatching((candidate) => candidate.owner !== null)
          resolved.push(entry)
          if (entry === null) {
            break
          }
        }

        lineMetadataByBlock.set(codeBlock, resolved)
      },
      postprocessRenderedLine: ({ codeBlock, lineIndex, renderData }) => {
        const entries = lineMetadataByBlock.get(codeBlock as ExpressiveCodeBlock)
        if (!entries) {
          return
        }

        const metadata = entries[lineIndex] ?? null
        const lineAst = renderData.lineAst
        const properties = (lineAst.properties ?? {}) as Record<string, unknown>

        if (!metadata) {
          delete properties['data-ls-owner']
          delete properties['data-ls-marker']
          if (Object.keys(properties).length === 0) {
            lineAst.properties = {} as HastProperties
          } else {
            lineAst.properties = properties as HastProperties
          }
          return
        }

        if (metadata.marker !== null) {
          properties['data-ls-marker'] = metadata.marker
        } else {
          delete properties['data-ls-marker']
        }

        if (metadata.owner !== null) {
          if (metadata.owner.length > 0) {
            properties['data-ls-owner'] = metadata.owner
          } else if (metadata.marker === null) {
            properties['data-ls-owner'] = ''
          }
        } else if (metadata.marker === null) {
          properties['data-ls-owner'] = ''
        } else {
          delete properties['data-ls-owner']
        }

        if (Object.keys(properties).length === 0) {
          lineAst.properties = {} as HastProperties
        } else {
          lineAst.properties = properties as HastProperties
        }
      },
    },
  })

const LINE_OWNER_PLUGIN_SIGNATURE = 'livestore-line-owner@1'

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
    createLineOwnerPlugin(),
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
    builtinPluginSignatures: [LINE_OWNER_PLUGIN_SIGNATURE],
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
