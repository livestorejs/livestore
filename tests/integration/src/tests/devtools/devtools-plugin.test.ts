/**
 * Regression guard: Devtools must never trigger Vite optimizeDeps during runtime.
 *
 * Known failure mode (issue #731):
 * - Opening /_livestore causes Vite to re-run optimizeDeps mid-request and respond 504 for prebundled deps.
 * - Observed in Playwright repro (minimal app) with 504s on @livestore_livestore.js / effect_Schema.js while Vite logs "Forced re-optimization".
 *
 * Guardrail:
 * - First /_livestore load may populate deps, but subsequent loads must not trigger re-optimisation or mutate .vite/deps.
 * - optimizeDeps should pre-include the schema entry while excluding only the known packages.
 */
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { type ConfigEnv, createServer, type ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'

const makeEnv = (): ConfigEnv => ({ command: 'serve', mode: 'development' })
const fixtureRoot = path.resolve(import.meta.dirname, 'fixtures', 'repro-731')
const devtoolsSchemaPath = './schema.ts'
const devtoolsSchemaEntry = path.join(fixtureRoot, 'schema.ts')

type ViteDevServerWithOptimizeDeps = ViteDevServer & {
  optimizeDeps?: {
    run: (options?: { force?: boolean; entries?: ReadonlyArray<string> }) => Promise<void>
  }
}

describe('livestoreDevtoolsPlugin (real Vite server)', () => {
  it('opening /_livestore should not trigger optimizeDeps artifacts (issue #731 repro)', async () => {
    const cacheDir = path.join(fixtureRoot, '.vite')
    fs.rmSync(cacheDir, { recursive: true, force: true })

    // Ensure the devtools schema is provided the same way the Playwright fixture does
    const prevEnv = process.env.TEST_LIVESTORE_SCHEMA_PATH_JSON
    process.env.TEST_LIVESTORE_SCHEMA_PATH_JSON = JSON.stringify(devtoolsSchemaPath)

    const server = (await createServer({
      configFile: path.join(fixtureRoot, 'vite.config.ts'),
      root: fixtureRoot,
      cacheDir,
      logLevel: 'error',
      clearScreen: false,
      server: { port: 0, host: '127.0.0.1' },
    })) as ViteDevServerWithOptimizeDeps
    const capturedLogs: string[] = []
    const loggerAny = server.config.logger as any
    const wrapLog = (method: 'warn' | 'error') => {
      if (typeof loggerAny[method] === 'function') {
        const orig = loggerAny[method].bind(loggerAny)
        loggerAny[method] = (msg: unknown, ...rest: unknown[]) => {
          capturedLogs.push(String(msg))
          return orig(msg, ...rest)
        }
      }
    }
    wrapLog('warn')
    wrapLog('error')

    try {
      await server.listen()
      if (server.optimizeDeps && typeof server.optimizeDeps.run === 'function') {
        await server.optimizeDeps.run({ force: true, entries: [devtoolsSchemaEntry] })
      }
      const address = server.httpServer?.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${address.port}`

      // Prime the normal app entry (ensures Vite actually loads the entry module, not just index.html)
      const appHtml = await fetch(baseUrl)
      expect(appHtml.status).toBe(200)
      const entryRes = await fetch(`${baseUrl}/main.ts`)
      expect(entryRes.status).toBe(200)

      const res = await fetch(`${baseUrl}/_livestore`)
      const body = await res.text()
      const depsAfterFirstDevtools = await waitForDepsStable(cacheDir)
      const metadataAfterFirstDevtools = readDepsMetadata(cacheDir)

      const resSecond = await fetch(`${baseUrl}/_livestore`)
      const depsAfterSecondDevtools = await waitForDepsStable(cacheDir)
      const metadataAfterSecondDevtools = readDepsMetadata(cacheDir)

      expect(res.status).toBe(200)
      expect(resSecond.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      expect(body.length).toBeGreaterThan(0)
      // Confirms no additional prebundle artifacts are produced after the first devtools load
      expect(depsAfterSecondDevtools).toEqual(depsAfterFirstDevtools)
      expect(metadataAfterSecondDevtools).toEqual(metadataAfterFirstDevtools)
    } finally {
      process.env.TEST_LIVESTORE_SCHEMA_PATH_JSON = prevEnv
      await server.close()
    }

    expect(capturedLogs.some((log) => log.includes('Outdated Optimize Dep'))).toBe(false)
  })

  it('adds schema to optimizeDeps entries while excluding known packages', async () => {
    const plugin = livestoreDevtoolsPlugin({ schemaPath: './schema.ts' })
    const baseConfig = { optimizeDeps: {} }

    const result = await runConfigHook(plugin, baseConfig, makeEnv())

    expect(result?.optimizeDeps?.entries?.some((entry: string) => entry.endsWith('/schema.ts'))).toBe(true)
    expect(result?.optimizeDeps?.force).toBeUndefined()
    expect(result?.optimizeDeps?.exclude).toEqual(['@livestore/devtools-vite', '@livestore/wa-sqlite'])
  })
})

const listDeps = (cacheDir: string): ReadonlyArray<string> => {
  const depsDir = path.join(cacheDir, 'deps')
  if (!fs.existsSync(depsDir)) {
    return []
  }
  return fs.readdirSync(depsDir).sort()
}

const readDepsMetadata = (cacheDir: string): string => {
  const metadataPath = path.join(cacheDir, 'deps', '_metadata.json')
  if (!fs.existsSync(metadataPath)) {
    return ''
  }
  return fs.readFileSync(metadataPath, 'utf8')
}

const waitForDepsStable = async (cacheDir: string): Promise<ReadonlyArray<string>> => {
  let prev = listDeps(cacheDir)
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const next = listDeps(cacheDir)
    if (next.join('|') === prev.join('|')) {
      return next
    }
    prev = next
  }
  return prev
}

const runConfigHook = async (plugin: any, config: Record<string, unknown>, env: ConfigEnv) => {
  const hook = plugin.config
  if (!hook) return config
  if (typeof hook === 'function') {
    return hook(config, env)
  }
  if ('handler' in hook && typeof hook.handler === 'function') {
    return hook.handler(config, env)
  }
  return config
}
