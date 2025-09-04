import fs from 'node:fs'
import path from 'node:path'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'
import * as integrationTests from '@local/tests-integration/run-tests'
import * as syncProviderTestsPrepare from '@local/tests-sync-provider/prepare-ci'

const cwd =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const isGithubAction = process.env.GITHUB_ACTIONS === 'true'

// GitHub actions log groups
const runTestGroup =
  (name: string) =>
  <E, C>(effect: Effect.Effect<unknown, E, C>) =>
    Effect.gen(function* () {
      console.log(`::group::${name}`)
      yield* effect
      console.log(`::endgroup::`)
    }).pipe(Effect.withSpan(`test-group(${name})`))

// Dynamically discover packages that have test files
const discoverPackagesWithTests = (excludePackages: string[] = []): string[] => {
  const packagesDir = path.join(cwd, 'packages')
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
          // Check if package has test files
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
      const packageCommonPath = path.join(cwd, 'tests/package-common')
      if (fs.existsSync(packageCommonPath) && hasTestFiles(packageCommonPath)) {
        results.push('tests/package-common')
      }
    }
  } catch (error) {
    console.warn('Warning: Failed to discover packages with tests:', error)
  }

  return results.sort()
}

// Helper function to check if a directory contains test files
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

// TODO: Consider replacing hardcoded package targeting with Vitest CLI flag passthrough
// This would allow more flexible test targeting using standard Vitest options like:
// - File patterns as positional arguments (e.g., mono test unit packages/@livestore/common)
// - --testNamePattern/-t for filtering tests by name
// - --exclude for excluding files
// - Other standard Vitest CLI flags for more precise test control
export const testUnitCommand = Cli.Command.make(
  'unit',
  {},
  Effect.fn(function* () {
    // Packages that need to run sequentially due to CI flakiness
    const sequentialPackages = ['packages/@livestore/webmesh', 'tests/package-common']

    // Dynamically discover all packages with tests, excluding sequential ones
    const allPackagesWithTests = discoverPackagesWithTests(sequentialPackages)

    // Some tests seem to be flaky on CI when running in parallel with the other packages, so we run them separately
    if (isGithubAction) {
      process.env.CI = '1'

      const vitestPathsToRunSequentially = sequentialPackages.map((pkg) => `${cwd}/${pkg}`)
      const vitestPathsToRunInParallel = allPackagesWithTests.map((pkg) => `${cwd}/${pkg}`)

      // Currently getting a bunch of flaky webmesh tests on CI (https://share.cleanshot.com/Q2WWD144)
      // Ignoring them for now but we should fix them eventually
      for (const vitestPath of vitestPathsToRunSequentially) {
        yield* runTestGroup(vitestPath)(cmd(`vitest run ${vitestPath}`, { cwd }).pipe(Effect.ignoreLogged))
      }

      // Run the rest of the tests in parallel
      if (vitestPathsToRunInParallel.length > 0) {
        yield* runTestGroup('Parallel tests')(cmd(['vitest', 'run', ...vitestPathsToRunInParallel], { cwd }))
      }
    } else {
      // For local development, run sequential packages first, then parallel ones
      const allPaths = [...sequentialPackages, ...allPackagesWithTests]

      yield* Effect.forEach(
        allPaths,
        (vitestPath) =>
          // TODO use this https://x.com/luxdav/status/1942532247833436656
          cmdText(`vitest run ${vitestPath}`, { cwd, stderr: 'pipe' }).pipe(
            Effect.tap((text) => console.log(`Output for ${vitestPath}:\n\n${text}\n\n`)),
          ),
        { concurrency: 'unbounded' },
      )
    }
  }),
)

export const testPerfCommand = Cli.Command.make(
  'perf',
  {},
  Effect.fn(function* () {
    yield* cmd('NODE_OPTIONS=--disable-warning=ExperimentalWarning pnpm playwright test', {
      cwd: `${cwd}/tests/perf`,
      shell: true,
    })
  }),
)

export const waSqliteTest = Cli.Command.make(
  'wa-sqlite',
  {},
  Effect.fn(function* () {
    yield* cmd('vitest run', { cwd: `${cwd}/tests/wa-sqlite` })
  }),
)

// the sync provider tests are actually part of another tests package but for now we run them from here too
// TODO clean this up at some point
export const syncProviderTest = Cli.Command.make(
  'sync-provider',
  {},
  Effect.fn(function* () {
    yield* syncProviderTestsPrepare.prepareCi

    yield* cmd(['vitest', 'run'], {
      cwd: `${cwd}/tests/sync-provider`,
    })
  }),
)

export const nodeSyncTest = Cli.Command.make(
  'node-sync',
  {},
  Effect.fn(function* () {
    const branch = process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF || process.env.GITHUB_BRANCH_NAME
    const isHypothesisBranch = typeof branch === 'string' && /ci-node-sync-hypo\//i.test(branch)

    yield* cmd(['vitest', 'run', 'src/tests/node-sync/node-sync.test.ts'], {
      cwd: `${cwd}/tests/integration`,
      env: {
        ...(isHypothesisBranch ? { NODE_SYNC_FC_NUMRUNS: '3' } : {}),
        ...(isHypothesisBranch ? { NODE_SYNC_MAX_CREATE_COUNT: '150' } : {}),
        ...(branch === 'ci-node-sync-hypo/h001-resume-on-advance' ? { LS_RESUME_PUSH_ON_ADVANCE: '1' } : {}),
      },
    })
  }),
)

const testIntegrationAllCommand = Cli.Command.make(
  'all',
  {
    concurrency: Cli.Options.choice('concurrency', ['sequential', 'parallel']).pipe(
      Cli.Options.withDefault('parallel'),
    ),
    localDevtoolsPreview: integrationTests.localDevtoolsPreviewOption,
  },
  Effect.fn(function* ({ concurrency, localDevtoolsPreview }) {
    yield* Effect.all(
      [
        integrationTests.miscTest.handler({ mode: 'headless', localDevtoolsPreview }),
        integrationTests.todomvcTest.handler({ mode: 'headless', localDevtoolsPreview }),
        integrationTests.devtoolsTest.handler({ mode: 'headless', localDevtoolsPreview }),
        syncProviderTest.handler({}),
        waSqliteTest.handler({}),
        nodeSyncTest.handler({}),
      ],
      { concurrency: concurrency === 'parallel' ? 'unbounded' : 1 },
    )
  }, Effect.withSpan('integration-tests:run-all')),
).pipe(Cli.Command.withDescription('Run all integration tests'))

export const testIntegrationCommand = Cli.Command.make('integration').pipe(
  Cli.Command.withSubcommands([
    ...integrationTests.commands,
    syncProviderTest,
    waSqliteTest,
    nodeSyncTest,
    testIntegrationAllCommand,
  ]),
)

// TODO when tests fail, print a command per failed test which allows running the test separately
export const testCommand = Cli.Command.make(
  'test',
  {},
  Effect.fn(function* () {
    yield* testUnitCommand.handler({})
    yield* testIntegrationAllCommand.handler({
      concurrency: isGithubAction ? 'sequential' : 'parallel',
      localDevtoolsPreview: false,
    })
    yield* waSqliteTest.handler({})
    yield* nodeSyncTest.handler({})
    yield* testPerfCommand.handler({})
  }),
).pipe(Cli.Command.withSubcommands([testIntegrationCommand, testUnitCommand, testPerfCommand]))
