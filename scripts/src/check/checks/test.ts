import fs from 'node:fs'
import path from 'node:path'

import { Effect } from '@livestore/utils/effect'
import { cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import * as integrationTests from '@local/tests-integration/run-tests'
import * as syncProviderTestsPrepare from '@local/tests-sync-provider/prepare-ci'

import { CheckEventPubSub } from '../events.ts'
import { runCommandWithEvents } from '../runner.ts'
import type { Check } from './types.ts'

// --- Helpers ---

/**
 * Dynamically discover packages that have test files and return their vitest project names.
 */
const discoverProjectsWithTests = (workspaceRoot: string, excludePackages: string[] = []): string[] => {
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
            // Return the project name format that vitest expects
            results.push(`@livestore/${pkg}`)
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
            results.push(`@local/${pkg}`)
          }
        }
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

/**
 * Files that, when changed, should trigger a full test run instead of --changed.
 */
const CRITICAL_CONFIG_FILES = [
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.dev.json',
  'pnpm-lock.yaml',
  'package.json',
]

/**
 * Check if any critical config files have been modified.
 */
const hasCriticalConfigChanges = (changedFiles: string[]): boolean => {
  return changedFiles.some((file) => CRITICAL_CONFIG_FILES.some((critical) => file.endsWith(critical)))
}

// --- Unit Tests ---

/**
 * Unit tests - all vitest-based tests across packages.
 * Uses --project flag to only load relevant workspace projects (faster collection).
 */
export const unitTestCheck: Check = {
  type: 'test',
  name: 'Unit Tests',
  fast: true,
  run: Effect.gen(function* () {
    const workspaceRoot = yield* LivestoreWorkspace

    // Packages that are known to have tests - use project names for faster loading
    const sequentialProjects = ['@livestore/webmesh']
    const otherProjects = discoverProjectsWithTests(workspaceRoot, [
      'packages/@livestore/webmesh',
      'tests/package-common',
    ])

    // Also include tests/package-common (not a vitest project, just a path)
    const allProjects = [...sequentialProjects, ...otherProjects]

    yield* CheckEventPubSub.publishOutput(
      'test',
      'Unit Tests',
      'stdout',
      `Running unit tests across ${allProjects.length + 1} packages...`,
    )

    // Build vitest command with --project flags for each workspace project
    // This is MUCH faster than passing directory paths because vitest only loads those projects
    const projectArgs = allProjects.flatMap((p) => ['--project', p])

    // Run vitest with project flags
    // Note: tests/package-common is passed as a path since it's not a named project
    yield* runCommandWithEvents('test', 'Unit Tests', [
      'vitest',
      'run',
      ...projectArgs,
      `${workspaceRoot}/tests/package-common`,
    ]).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
  }),
}

/**
 * Changed tests - only run tests for files that have changed.
 * Falls back to full tests if critical config files changed.
 */
export const changedTestCheck: Check = {
  type: 'test',
  name: 'Changed Tests',
  fast: true,
  run: Effect.gen(function* () {
    const workspaceRoot = yield* LivestoreWorkspace

    // Get list of changed files (staged + unstaged)
    const stagedFiles = yield* cmdText('git diff --cached --name-only', { runInShell: true }).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
      Effect.map((s) => s.trim().split('\n').filter(Boolean)),
    )

    const unstagedFiles = yield* cmdText('git diff --name-only', { runInShell: true }).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
      Effect.map((s) => s.trim().split('\n').filter(Boolean)),
    )

    const changedFiles = [...new Set([...stagedFiles, ...unstagedFiles])]

    if (changedFiles.length === 0) {
      yield* CheckEventPubSub.publishOutput('test', 'Changed Tests', 'stdout', 'No files changed, skipping tests.')
      return
    }

    yield* CheckEventPubSub.publishOutput(
      'test',
      'Changed Tests',
      'stdout',
      `Found ${changedFiles.length} changed file(s)...`,
    )

    // Check if critical config files changed - if so, run full tests
    if (hasCriticalConfigChanges(changedFiles)) {
      yield* CheckEventPubSub.publishOutput(
        'test',
        'Changed Tests',
        'stdout',
        'Critical config changed, running full test suite...',
      )

      // Fall back to the same logic as unitTestCheck
      const sequentialProjects = ['@livestore/webmesh']
      const otherProjects = discoverProjectsWithTests(workspaceRoot, [
        'packages/@livestore/webmesh',
        'tests/package-common',
      ])
      const allProjects = [...sequentialProjects, ...otherProjects]
      const projectArgs = allProjects.flatMap((p) => ['--project', p])

      yield* runCommandWithEvents('test', 'Changed Tests', [
        'vitest',
        'run',
        ...projectArgs,
        `${workspaceRoot}/tests/package-common`,
      ]).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
    } else {
      // Use vitest's built-in --changed flag
      // This runs tests related to uncommitted changes
      yield* CheckEventPubSub.publishOutput(
        'test',
        'Changed Tests',
        'stdout',
        'Running tests for changed files only...',
      )

      yield* runCommandWithEvents('test', 'Changed Tests', ['vitest', 'run', '--changed']).pipe(
        Effect.provide(LivestoreWorkspace.toCwd()),
      )
    }
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
