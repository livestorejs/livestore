import fs from 'node:fs'
import path from 'node:path'

import { Effect } from '@livestore/utils/effect'
import { LivestoreWorkspace } from '@livestore/utils-dev/node'
import * as integrationTests from '@local/tests-integration/run-tests'
import * as syncProviderTestsPrepare from '@local/tests-sync-provider/prepare-ci'

import { CheckEventPubSub } from '../events.ts'
import { runCommandWithEvents } from '../runner.ts'
import type { Check } from './types.ts'

// --- Helpers ---

/**
 * Dynamically discover packages that have test files.
 */
const discoverPackagesWithTests = (workspaceRoot: string, excludePackages: string[] = []): string[] => {
  const packagesDir = path.join(workspaceRoot, 'packages')
  const results: string[] = []

  try {
    // Check packages/@livestore/* directories
    const liveStoreDir = path.join(packagesDir, '@livestore')
    if (fs.existsSync(liveStoreDir)) {
      const liveStorePackages = fs.readdirSync(liveStoreDir)
      for (const pkg of liveStorePackages) {
        const pkgPath = path.join(liveStoreDir, pkg)
        const relativePath = `packages/@livestore/${pkg}`

        if (excludePackages.includes(relativePath)) continue

        if (fs.statSync(pkgPath).isDirectory()) {
          const hasTests = hasTestFiles(pkgPath)
          if (hasTests) {
            results.push(relativePath)
          }
        }
      }
    }

    // Check packages/@local/* directories
    const localDir = path.join(packagesDir, '@local')
    if (fs.existsSync(localDir)) {
      const localPackages = fs.readdirSync(localDir)
      for (const pkg of localPackages) {
        const pkgPath = path.join(localDir, pkg)
        const relativePath = `packages/@local/${pkg}`

        if (excludePackages.includes(relativePath)) continue

        if (fs.statSync(pkgPath).isDirectory()) {
          const hasTests = hasTestFiles(pkgPath)
          if (hasTests) {
            results.push(relativePath)
          }
        }
      }
    }

    // Also check tests/package-common if not excluded
    if (!excludePackages.includes('tests/package-common')) {
      const packageCommonPath = path.join(workspaceRoot, 'tests/package-common')
      if (fs.existsSync(packageCommonPath) && hasTestFiles(packageCommonPath)) {
        results.push('tests/package-common')
      }
    }
  } catch (error) {
    console.warn('Warning: Failed to discover packages with tests:', error)
  }

  return results.sort()
}

/**
 * Check if a directory contains test files.
 */
const hasTestFiles = (dirPath: string): boolean => {
  try {
    const findTestFiles = (dir: string): boolean => {
      const entries = fs.readdirSync(dir)

      for (const entry of entries) {
        const entryPath = path.join(dir, entry)
        const stat = fs.statSync(entryPath)

        if (stat.isFile() && (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx'))) {
          return true
        }

        if (stat.isDirectory() && entry !== 'node_modules' && entry !== 'dist') {
          if (findTestFiles(entryPath)) {
            return true
          }
        }
      }

      return false
    }

    return findTestFiles(dirPath)
  } catch {
    return false
  }
}

// --- Unit Tests ---

/**
 * Unit tests - all vitest-based tests across packages.
 * This is fast enough to include in the default path.
 */
export const unitTestCheck: Check = {
  type: 'test',
  name: 'Unit Tests',
  fast: true,
  run: Effect.gen(function* () {
    const workspaceRoot = yield* LivestoreWorkspace

    // Packages that need to run sequentially due to CI flakiness
    const sequentialPackages = ['packages/@livestore/webmesh', 'tests/package-common']

    // Dynamically discover all packages with tests, excluding sequential ones
    const allPackagesWithTests = discoverPackagesWithTests(workspaceRoot, sequentialPackages)

    // Combine all paths
    const allPaths = [...sequentialPackages, ...allPackagesWithTests].map((pkg) => `${workspaceRoot}/${pkg}`)

    yield* CheckEventPubSub.publishOutput(
      'test',
      'Unit Tests',
      'stdout',
      `Running unit tests across ${allPaths.length} packages...`,
    )

    // Run all tests together via vitest (it handles parallelization internally)
    yield* runCommandWithEvents('test', 'Unit Tests', ['vitest', 'run', ...allPaths]).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
    )
  }),
}

// --- Integration Tests ---

/**
 * Integration tests - Playwright-based browser tests.
 * These are slow and only run with --full.
 */
export const integrationMiscTest: Check = {
  type: 'test',
  name: 'Integration (Misc)',
  fast: false,
  run: integrationTests.miscTest
    .handler({ mode: 'headless', localDevtoolsPreview: false })
    .pipe(Effect.asVoid, Effect.provide(LivestoreWorkspace.toCwd())),
}

export const integrationTodomvcTest: Check = {
  type: 'test',
  name: 'Integration (TodoMVC)',
  fast: false,
  run: integrationTests.todomvcTest
    .handler({ mode: 'headless', localDevtoolsPreview: false })
    .pipe(Effect.asVoid, Effect.provide(LivestoreWorkspace.toCwd())),
}

export const integrationDevtoolsTest: Check = {
  type: 'test',
  name: 'Integration (Devtools)',
  fast: false,
  run: integrationTests.devtoolsTest
    .handler({ mode: 'headless', localDevtoolsPreview: false })
    .pipe(Effect.asVoid, Effect.provide(LivestoreWorkspace.toCwd())),
}

export const syncProviderTest: Check = {
  type: 'test',
  name: 'Sync Provider',
  fast: false,
  run: Effect.gen(function* () {
    yield* syncProviderTestsPrepare.prepareCi
    yield* runCommandWithEvents('test', 'Sync Provider', ['vitest', 'run']).pipe(
      Effect.provide(LivestoreWorkspace.toCwd('tests/sync-provider')),
    )
  }),
}

export const waSqliteTest: Check = {
  type: 'test',
  name: 'WA-SQLite',
  fast: false,
  run: runCommandWithEvents('test', 'WA-SQLite', 'vitest run').pipe(
    Effect.provide(LivestoreWorkspace.toCwd('tests/wa-sqlite')),
  ),
}

export const nodeSyncTest: Check = {
  type: 'test',
  name: 'Node Sync',
  fast: false,
  run: runCommandWithEvents('test', 'Node Sync', ['vitest', 'run', 'src/tests/node-sync/node-sync.test.ts']).pipe(
    Effect.provide(LivestoreWorkspace.toCwd('tests/integration')),
  ),
}

export const perfTest: Check = {
  type: 'test',
  name: 'Performance',
  fast: false,
  run: runCommandWithEvents(
    'test',
    'Performance',
    'NODE_OPTIONS=--disable-warning=ExperimentalWarning pnpm playwright test',
    { shell: true, env: { FORCE_PLAYWRIGHT_VIA_CLI: '1' } },
  ).pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/perf'))),
}

// --- Aggregated checks ---

/**
 * Fast test checks (for default `mono check`).
 */
export const fastTestChecks: Check[] = [unitTestCheck]

/**
 * Slow test checks (only run with `--full`).
 */
export const slowTestChecks: Check[] = [
  integrationMiscTest,
  integrationTodomvcTest,
  integrationDevtoolsTest,
  syncProviderTest,
  waSqliteTest,
  nodeSyncTest,
  perfTest,
]

/**
 * All test checks.
 */
export const allTestChecks: Check[] = [...fastTestChecks, ...slowTestChecks]
