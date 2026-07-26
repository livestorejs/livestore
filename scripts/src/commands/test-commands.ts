import fs from 'node:fs'
import path from 'node:path'

import { cmd, cmdText, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect, Option, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import * as integrationTests from '@local/tests-integration/run-tests'
import * as syncProviderTestsPrepare from '@local/tests-sync-provider/prepare-ci'
import {
  providerKeys,
  providerSelectionEnvVar,
  type ProviderKey as TSyncProviderChoice,
} from '@local/tests-sync-provider/registry'

import * as TestPolicy from '../shared/test-policy.ts'

const isGithubAction = process.env.GITHUB_ACTIONS === 'true'

const ciUnitTestPackageConcurrency = (() => {
  const raw = process.env.LIVESTORE_TEST_UNIT_CONCURRENCY
  if (raw === undefined || raw === '') return 4

  const parsed = Number.parseInt(raw, 10)
  if (Number.isFinite(parsed) === false || parsed < 1) {
    throw new Error(`LIVESTORE_TEST_UNIT_CONCURRENCY must be a positive integer, got ${JSON.stringify(raw)}`)
  }

  return parsed
})()

// GitHub actions log groups
/**
 * Closes the log group on every exit path. A group left open on failure swallows the
 * rest of the job output into a collapsed section, hiding the very failure that caused it.
 */
const runTestGroup =
  (name: string) =>
  <E, C>(effect: Effect.Effect<unknown, E, C>) =>
    Effect.gen(function* () {
      console.log(`::group::${name}`)
      yield* effect
    }).pipe(Effect.ensuring(Effect.sync(() => console.log(`::endgroup::`))), Effect.withSpan(`test-group(${name})`))

interface TestTarget {
  path: string
  config?: string
}

const vitestConfigPattern = /^vitest.*\.config\.(ts|js)$/

/** Find vitest config files in a directory (root and tests/ subdirectory). */
const findVitestConfigs = (pkgPath: string): string[] => {
  const configs: string[] = []
  for (const file of fs.readdirSync(pkgPath)) {
    if (vitestConfigPattern.test(file) === true) configs.push(path.join(pkgPath, file))
  }
  const testsDir = path.join(pkgPath, 'tests')
  if (fs.existsSync(testsDir) === true && fs.statSync(testsDir).isDirectory() === true) {
    for (const file of fs.readdirSync(testsDir)) {
      if (vitestConfigPattern.test(file) === true) configs.push(path.join(testsDir, file))
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
    if (fs.existsSync(liveStoreDir) === true) {
      const liveStorePackages = fs.readdirSync(liveStoreDir)
      for (const pkg of liveStorePackages) {
        const pkgPath = path.join(liveStoreDir, pkg)
        const relativePath = `packages/@livestore/${pkg}`

        if (excludePackages.includes(relativePath) === true) continue

        if (fs.statSync(pkgPath).isDirectory() === true) {
          // Check if package has test files
          const hasTests = hasTestFiles(pkgPath)
          if (hasTests === true) {
            addPackage(pkgPath, relativePath)
          }
        }
      }
    }

    // Check packages/@local/* directories
    const localDir = path.join(packagesDir, '@local')
    if (fs.existsSync(localDir) === true) {
      const localPackages = fs.readdirSync(localDir)
      for (const pkg of localPackages) {
        const pkgPath = path.join(localDir, pkg)
        const relativePath = `packages/@local/${pkg}`

        if (excludePackages.includes(relativePath) === true) continue

        if (fs.statSync(pkgPath).isDirectory() === true) {
          const hasTests = hasTestFiles(pkgPath)
          if (hasTests === true) {
            addPackage(pkgPath, relativePath)
          }
        }
      }
    }

    // Test roots outside packages/*. Without these the unit lane silently omits suites that
    // exist and pass locally — `scripts/` carried 4 test files that no CI job ever ran.
    for (const extraRoot of ['tests/package-common', 'scripts']) {
      if (excludePackages.includes(extraRoot) === true) continue

      const extraPath = path.join(workspaceRoot, extraRoot)
      if (fs.existsSync(extraPath) === true && hasTestFiles(extraPath) === true) {
        addPackage(extraPath, extraRoot)
      }
    }
  } catch (error) {
    // Swallowing this would silently shrink the unit lane to a partial run that still
    // reports success — the failure mode the whole lane exists to rule out.
    throw new Error(`Failed to discover packages with tests under ${workspaceRoot}`, { cause: error })
  }

  return results.toSorted((a, b) => a.path.localeCompare(b.path))
}

// Helper function to check if a directory contains test files
const hasTestFiles = (dirPath: string): boolean => {
  try {
    const findTestFiles = (dir: string): boolean => {
      const entries = fs.readdirSync(dir)

      for (const entry of entries) {
        const entryPath = path.join(dir, entry)
        const stat = fs.statSync(entryPath)

        if (stat.isFile() === true && (entry.endsWith('.test.ts') === true || entry.endsWith('.test.tsx') === true)) {
          return true
        }

        if (stat.isDirectory() === true && entry !== 'node_modules' && entry !== 'dist') {
          if (findTestFiles(entryPath) === true) {
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
const runUnitTests = Effect.fn(function* ({ filter }: { filter: Option.Option<string> }) {
  const workspaceRoot = yield* LivestoreWorkspace

  if (Option.isSome(filter) === true) {
    const target = path.isAbsolute(filter.value) === true ? filter.value : path.join(workspaceRoot, filter.value)
    const configs = findVitestConfigs(target)
    if (configs.length > 0) {
      yield* Effect.forEach(
        configs,
        (config) =>
          TestPolicy.runTestTarget({
            label: config,
            policy: TestPolicy.blocking,
            run: cmd(['vitest', 'run', '--config', config]).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
          }),
        { concurrency: 'unbounded' },
      )
    } else {
      yield* TestPolicy.runTestTarget({
        label: target,
        policy: TestPolicy.blocking,
        run: cmd(['vitest', 'run', target]).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
      })
    }
    return
  }

  // Packages that need to run sequentially due to CI flakiness
  const sequentialPackages = ['packages/@livestore/webmesh', 'tests/package-common']

  // Dynamically discover all packages with tests, excluding sequential ones
  const allPackagesWithTests = discoverPackagesWithTests(workspaceRoot, sequentialPackages)

  // Some tests seem to be flaky on CI when running in parallel with the other packages, so we run them separately
  if (isGithubAction === true) {
    process.env.CI = '1'

    const vitestPathsToRunSequentially = sequentialPackages.map((pkg) => `${workspaceRoot}/${pkg}`)

    for (const vitestPath of vitestPathsToRunSequentially) {
      yield* runTestGroup(vitestPath)(
        TestPolicy.runTestTarget({
          label: vitestPath,
          policy: TestPolicy.blocking,
          run: cmd(`vitest run ${vitestPath}`).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
        }),
      )
    }

    // Run the rest of the tests in parallel (each config as separate vitest invocation)
    if (allPackagesWithTests.length > 0) {
      yield* runTestGroup('Parallel tests')(
        Effect.forEach(
          allPackagesWithTests,
          (target) => {
            const args =
              target.config !== undefined
                ? ['vitest', 'run', '--config', target.config]
                : ['vitest', 'run', `${workspaceRoot}/${target.path}`]
            return TestPolicy.runTestTarget({
              label: target.config ?? target.path,
              policy: TestPolicy.blocking,
              run: cmd(args).pipe(Effect.provide(LivestoreWorkspace.toCwd())),
            })
          },
          { concurrency: ciUnitTestPackageConcurrency },
        ),
      )
    }
  } else {
    // For local development, run all in parallel (including sequential packages)
    const sequentialTargets: TestTarget[] = sequentialPackages.map((pkg) => ({ path: pkg }))
    yield* Effect.forEach(
      [...sequentialTargets, ...allPackagesWithTests],
      (target) => {
        const args =
          target.config !== undefined
            ? ['vitest', 'run', '--config', target.config]
            : ['vitest', 'run', `${workspaceRoot}/${target.path}`]
        const label = target.config ?? target.path
        // TODO use this https://x.com/luxdav/status/1942532247833436656
        return TestPolicy.runTestTarget({
          label,
          policy: TestPolicy.blocking,
          run: cmdText(args.join(' '), { stderr: 'pipe' }).pipe(
            Effect.provide(LivestoreWorkspace.toCwd()),
            Effect.tap((text) => Effect.sync(() => console.log(`Output for ${label}:\n\n${text}\n\n`))),
          ),
        })
      },
      { concurrency: 'unbounded' },
    )
  }
})

export const testUnitCommand = Cli.Command.make(
  'unit',
  {
    filter: Cli.Flag.string('filter').pipe(
      Cli.Flag.optional,
      Cli.Flag.withDescription('Run only test suites whose path includes this substring'),
    ),
  },
  runUnitTests,
)

const runPerfTests = Effect.fn(function* () {
  yield* TestPolicy.runTestTarget({
    label: 'tests/perf',
    policy: TestPolicy.blocking,
    run: cmd('NODE_OPTIONS=--disable-warning=ExperimentalWarning pnpm playwright test', {
      shell: true,
      env: { FORCE_PLAYWRIGHT_VIA_CLI: '1' },
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/perf'))),
  })
})

export const testPerfCommand = Cli.Command.make('perf', {}, runPerfTests)

const runWaSqliteTests = Effect.fn(function* () {
  yield* TestPolicy.runTestTarget({
    label: 'tests/wa-sqlite',
    policy: TestPolicy.blocking,
    run: cmd('vitest run').pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/wa-sqlite'))),
  })
})

export const waSqliteTest = Cli.Command.make('wa-sqlite', {}, runWaSqliteTests)

// the sync provider tests are actually part of another tests package but for now we run them from here too
// TODO clean this up at some point

/** A run in which the suite that had to prove something never executed. */
export class NoTestsExecutedError extends Schema.TaggedErrorClass<NoTestsExecutedError>()('NoTestsExecutedError', {
  reportPath: Schema.String,
  suiteFile: Schema.String,
}) {}

/** The subset of Vitest's JSON reporter output this guard depends on. */
const VitestRunReport = Schema.Struct({
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      assertionResults: Schema.Array(Schema.Struct({ status: Schema.String })),
    }),
  ),
})

/** File whose tests every sync-provider cell must actually execute to have proven anything. */
const syncProviderConformanceSuite = 'sync-provider.test.ts'

/**
 * Fails when `suiteFile` executed no tests. Selection is resolved in-process against the
 * provider registry, so a cell can no longer silently select nothing — this is the backstop
 * against a bad `include` glob or an over-broad skip leaving the job vacuously green.
 *
 * Scoped to one file rather than the run's total: utility suites that run in every cell
 * (`registry.test.ts`) would otherwise keep the count non-zero even if the conformance suite
 * were skipped entirely. Failed tests count as executed — a quarantined run where everything
 * fails has still proven something, and rejecting it here would defeat the quarantine.
 */
export const assertTestsExecuted = Effect.fn(function* ({
  reportPath,
  suiteFile,
}: {
  readonly reportPath: string
  readonly suiteFile: string
}) {
  const raw = fs.readFileSync(reportPath, 'utf8')
  const report = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(VitestRunReport))(raw)

  const executed = report.testResults
    .filter((file) => path.basename(file.name) === suiteFile)
    .flatMap((file) => file.assertionResults)
    .filter((assertion) => assertion.status === 'passed' || assertion.status === 'failed').length

  if (executed === 0) {
    return yield* new NoTestsExecutedError({ reportPath, suiteFile })
  }
})

const runSyncProviderTests = Effect.fn(function* ({ provider }: { provider: Option.Option<TSyncProviderChoice> }) {
  yield* syncProviderTestsPrepare.prepareCi

  const workspaceRoot = yield* LivestoreWorkspace
  const reportPath = path.join(workspaceRoot, 'tmp/sync-provider-run-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })

  yield* TestPolicy.runTestTarget({
    label: Option.isSome(provider) === true ? `sync-provider:${provider.value}` : 'sync-provider',
    policy: TestPolicy.blocking,
    run: cmd(['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`], {
      // Selection happens at collection time via the registry rather than by matching test
      // titles, so renaming a suite can no longer remove it from a CI cell (#1429).
      env: Option.isSome(provider) === true ? { [providerSelectionEnvVar]: provider.value } : {},
    }).pipe(Effect.provide(LivestoreWorkspace.toCwd('tests/sync-provider'))),
  })

  yield* assertTestsExecuted({ reportPath, suiteFile: syncProviderConformanceSuite })
})

export const syncProviderTest = Cli.Command.make(
  'sync-provider',
  {
    provider: Cli.Flag.choice('provider', [...providerKeys]).pipe(
      Cli.Flag.optional,
      Cli.Flag.withDescription('Run only a specific sync provider test suite'),
    ),
  },
  runSyncProviderTests,
).pipe(Cli.Command.withDescription('Run sync provider tests (optionally filtered by provider)'))

const runIntegrationAllTests = Effect.fn('integration-tests:run-all')(function* ({
  concurrency,
  localDevtoolsPreview,
}: {
  readonly concurrency: 'sequential' | 'parallel'
  readonly localDevtoolsPreview: boolean
}) {
  yield* Effect.all(
    [
      integrationTests.runMiscTest({ mode: 'headless', localDevtoolsPreview }),
      integrationTests.runTodomvcTest({ mode: 'headless', localDevtoolsPreview }),
      integrationTests.runDevtoolsTest({ mode: 'headless', localDevtoolsPreview }),
      runSyncProviderTests({ provider: Option.none() }),
      runWaSqliteTests(),
    ],
    { concurrency: concurrency === 'parallel' ? 'unbounded' : 1 },
  )
})

const testIntegrationAllCommand = Cli.Command.make(
  'all',
  {
    concurrency: Cli.Flag.choice('concurrency', ['sequential', 'parallel']).pipe(Cli.Flag.withDefault('parallel')),
    localDevtoolsPreview: integrationTests.localDevtoolsPreviewOption,
  },
  runIntegrationAllTests,
).pipe(Cli.Command.withDescription('Run all integration tests'))

/**
 * Wraps the DevTools suite so its declared quarantine is enforced at the invocation, rather
 * than as an `|| echo` in the CI task wrapper that nothing records and devenv discards.
 */
const devtoolsCommand = Cli.Command.make(
  'devtools',
  { mode: integrationTests.modeOption, localDevtoolsPreview: integrationTests.localDevtoolsPreviewOption },
  (args) =>
    TestPolicy.runTestTarget({
      label: 'tests/integration:devtools',
      policy: TestPolicy.quarantined('devtools-suite'),
      run: integrationTests.runDevtoolsTest(args),
    }),
)

export const testIntegrationCommand = Cli.Command.make('integration').pipe(
  Cli.Command.withSubcommands([
    integrationTests.miscTest,
    integrationTests.todomvcTest,
    integrationTests.setupDevtools,
    devtoolsCommand,
    syncProviderTest,
    waSqliteTest,
    testIntegrationAllCommand,
  ]),
)

// TODO when tests fail, print a command per failed test which allows running the test separately
export const testCommand = Cli.Command.make(
  'test',
  {},
  Effect.fn(function* () {
    yield* runUnitTests({ filter: Option.none() })
    yield* runIntegrationAllTests({
      concurrency: isGithubAction === true ? 'sequential' : 'parallel',
      localDevtoolsPreview: false,
    })
    yield* runWaSqliteTests()
    yield* runPerfTests()
  }),
).pipe(Cli.Command.withSubcommands([testIntegrationCommand, testUnitCommand, testPerfCommand]))
