import fs from 'node:fs'
import path from 'node:path'

import { Effect, Option } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import * as integrationTests from '@local/tests-integration/run-tests'
import * as syncProviderTestsPrepare from '@local/tests-sync-provider/prepare-ci'
import {
  providerKeys,
  providerRegistry,
  type ProviderKey as TSyncProviderChoice,
} from '@local/tests-sync-provider/registry'

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

interface TestTarget {
  path: string
  config?: string
}

const vitestConfigPattern = /^vitest.*\.config\.(ts|js)$/

/** Find vitest config files in a directory (root and tests/ subdirectory). */
const findVitestConfigs = (pkgPath: string): string[] => {
  const configs: string[] = []
  for (const file of fs.readdirSync(pkgPath)) {
    if (vitestConfigPattern.test(file)) configs.push(path.join(pkgPath, file))
  }
  const testsDir = path.join(pkgPath, 'tests')
  if (fs.existsSync(testsDir) && fs.statSync(testsDir).isDirectory()) {
    for (const file of fs.readdirSync(testsDir)) {
      if (vitestConfigPattern.test(file)) configs.push(path.join(testsDir, file))
    }
  }
  return configs
}

// Dynamically discover packages that have test files
const discoverPackagesWithTests = (workspaceRoot: string, excludePackages: string[] = []): TestTarget[] => {
  const packagesDir = path.join(workspaceRoot, 'packages')
  const results: TestTarget[] = []

  const addPackage = (pkgPath: string, relativePath: string) => {
    const configs = findVitestConfigs(pkgPath)
    if (configs.length > 0) {
      for (const config of configs) results.push({ path: relativePath, config })
    } else {
      results.push({ path: relativePath })
    }
  }

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
            addPackage(pkgPath, relativePath)
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
            addPackage(pkgPath, relativePath)
          }
        }
      }
    }

    // Also check tests/package-common if not excluded
    if (!excludePackages.includes('tests/package-common')) {
      const packageCommonPath = path.join(workspaceRoot, 'tests/package-common')
      if (fs.existsSync(packageCommonPath) && hasTestFiles(packageCommonPath)) {
        addPackage(packageCommonPath, 'tests/package-common')
      }
    }
  } catch (error) {
    console.warn('Warning: Failed to discover packages with tests:', error)
  }

  return results.sort((a, b) => a.path.localeCompare(b.path))
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
  {
    filter: Cli.Options.text('filter').pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Run only test suites whose path includes this substring'),
    ),
  },
  Effect.fn(function* ({ filter }) {
    const workspaceRoot = yield* LivestoreWorkspace

    if (Option.isSome(filter)) {
      const target = path.isAbsolute(filter.value) ? filter.value : path.join(workspaceRoot, filter.value)
      const configs = findVitestConfigs(target)
      if (configs.length > 0) {
        yield* Effect.forEach(
          configs,
          (config) => cmd(['vitest', 'run', '--config', config]).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
          { concurrency: 'unbounded' },
        )
      } else {
        yield* cmd(['vitest', 'run', target]).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
      }
      return
    }

    // Packages that need to run sequentially due to CI flakiness
    const sequentialPackages = ['packages/@livestore/webmesh', 'tests/package-common']

    // Dynamically discover all packages with tests, excluding sequential ones
    const allPackagesWithTests = discoverPackagesWithTests(workspaceRoot, sequentialPackages)

    // Some tests seem to be flaky on CI when running in parallel with the other packages, so we run them separately
    if (isGithubAction) {
      process.env.CI = '1'

      const vitestPathsToRunSequentially = sequentialPackages.map((pkg) => `${workspaceRoot}/${pkg}`)

      // Currently getting a bunch of flaky webmesh tests on CI (https://share.cleanshot.com/Q2WWD144)
      // Ignoring them for now but we should fix them eventually
      for (const vitestPath of vitestPathsToRunSequentially) {
        yield* runTestGroup(vitestPath)(
          cmd(`vitest run ${vitestPath}`).pipe(Effect.ignoreLogged, Effect.provide(LivestoreWorkspace.toCwd())),
        )
      }

      // Run the rest of the tests in parallel (each config as separate vitest invocation)
      if (allPackagesWithTests.length > 0) {
        yield* runTestGroup('Parallel tests')(
          Effect.forEach(
            allPackagesWithTests,
            (target) => {
              const args = target.config
                ? ['vitest', 'run', '--config', target.config]
                : ['vitest', 'run', `${workspaceRoot}/${target.path}`]
              return cmd(args).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
            },
            { concurrency: 'unbounded' },
          ),
        )
      }
    } else {
      // For local development, run all in parallel (including sequential packages)
      const sequentialTargets: TestTarget[] = sequentialPackages.map((pkg) => ({ path: pkg }))
      yield* Effect.forEach(
        [...sequentialTargets, ...allPackagesWithTests],
        (target) => {
          const args = target.config
            ? ['vitest', 'run', '--config', target.config]
            : ['vitest', 'run', `${workspaceRoot}/${target.path}`]
          const label = target.config ?? target.path
          // TODO use this https://x.com/luxdav/status/1942532247833436656
          return cmdText(args.join(' '), { stderr: 'pipe' }).pipe(
            Effect.provide(LivestoreWorkspace.toCwd()),
            Effect.tap((text) => console.log(`Output for ${label}:\n\n${text}\n\n`)),
          )
        },
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
      shell: true,
      env: { FORCE_PLAYWRIGHT_VIA_CLI: '1' },
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/perf')))
  }),
)

export const waSqliteTest = Cli.Command.make(
  'wa-sqlite',
  {},
  Effect.fn(function* () {
    yield* cmd('vitest run').pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/wa-sqlite')))
  }),
)

// the sync provider tests are actually part of another tests package but for now we run them from here too
// TODO clean this up at some point
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const syncProviderTest = Cli.Command.make(
  'sync-provider',
  {
    provider: Cli.Options.choice('provider', [...providerKeys]).pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Run only a specific sync provider test suite'),
    ),
  },
  Effect.fn(function* ({ provider }: { provider: Option.Option<TSyncProviderChoice> }) {
    yield* syncProviderTestsPrepare.prepareCi

    const args: string[] = ['vitest', 'run']
    if (Option.isSome(provider)) {
      const suite = providerRegistry[provider.value].name
      // Vitest may render the provider name wrapped in quotes in the full test title.
      // Use a forgiving pattern that matches with or without surrounding quotes.
      const pattern = `["']?${escapeRegex(suite)}["']? sync provider`
      args.push('--testNamePattern', pattern)
    }

    yield* cmd(args).pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/sync-provider')))
  }),
).pipe(Cli.Command.withDescription('Run sync provider tests (optionally filtered by provider)'))

export const nodeSyncTest = Cli.Command.make(
  'node-sync',
  {},
  Effect.fn(function* () {
    yield* cmd(['vitest', 'run', 'src/tests/node-sync/node-sync.test.ts']).pipe(
      Effect.provide(LivestoreWorkspace.toCwd('tests/integration')),
    )
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
        syncProviderTest.handler({ provider: Option.none() }),
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
    yield* testUnitCommand.handler({ filter: Option.none() })
    yield* testIntegrationAllCommand.handler({
      concurrency: isGithubAction ? 'sequential' : 'parallel',
      localDevtoolsPreview: false,
    })
    yield* waSqliteTest.handler({})
    yield* nodeSyncTest.handler({})
    yield* testPerfCommand.handler({})
  }),
).pipe(Cli.Command.withSubcommands([testIntegrationCommand, testUnitCommand, testPerfCommand]))
