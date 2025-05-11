import fs from 'node:fs'

import { Effect, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText, OtelLiveHttp } from '@livestore/utils-dev/node'
import * as integrationTests from '@local/tests-integration/run-tests'

import { copyTodomvcSrc } from './examples/copy-examples.js'
import { command as deployExamplesCommand } from './examples/deploy-examples.js'
import * as generateExamples from './examples/generate-examples.js'

const cwd = process.env.WORKSPACE_ROOT
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

const testUnitCommand = Cli.Command.make(
  'unit',
  {},
  Effect.fn(function* () {
    // Some tests seem to be flaky on CI when running in parallel with the other packages, so we run them separately
    if (isGithubAction) {
      process.env.CI = '1'

      const vitestPathsToRunSequentially = [`${cwd}/packages/@livestore/webmesh`, `${cwd}/tests/package-common`]
      const vitestPathsToRunInParallel = [
        `${cwd}/packages/@livestore/utils`,
        `${cwd}/packages/@livestore/common`,
        `${cwd}/packages/@livestore/livestore`,
      ]

      // Currently getting a bunch of flaky webmesh tests on CI (https://share.cleanshot.com/Q2WWD144)
      // Ignoring them for now but we should fix them eventually
      for (const vitestPath of vitestPathsToRunSequentially) {
        yield* runTestGroup(vitestPath)(cmd(`vitest run ${vitestPath}`, { cwd }).pipe(Effect.ignoreLogged))
      }

      // Run the rest of the tests in parallel
      yield* runTestGroup('Parallel tests')(cmd(['vitest', 'run', ...vitestPathsToRunInParallel], { cwd }))
    } else {
      yield* cmd('vitest run')
    }
  }),
)

const testCommand = Cli.Command.make(
  'test',
  {},
  Effect.fn(function* () {
    yield* testUnitCommand.handler({})
    yield* integrationTests.runAll.handler({ concurrency: isGithubAction ? 'sequential' : 'parallel' })
  }),
).pipe(Cli.Command.withSubcommands([integrationTests.command, testUnitCommand]))

const lintCommand = Cli.Command.make(
  'lint',
  { fix: Cli.Options.boolean('fix').pipe(Cli.Options.withDefault(false)) },
  Effect.fn(function* ({ fix }) {
    const fixFlag = fix ? '--fix' : ''
    yield* cmd(`eslint scripts examples packages website --ext .ts,.tsx --max-warnings=0 ${fixFlag}`, { shell: true })
    if (fix) {
      yield* cmd('syncpack format', { cwd })
    }

    yield* cmd('syncpack lint', { cwd })

    // Shell needed for wildcards
    yield* cmd('madge --circular --no-spinner examples/src/*/src packages/*/*/src', { cwd, shell: true })
  }),
)

const websiteBuildCommand = Cli.Command.make(
  'build',
  { apiDocs: Cli.Options.boolean('api-docs').pipe(Cli.Options.withDefault(false)) },
  ({ apiDocs }) =>
    cmd('pnpm astro build', {
      cwd: `${process.env.WORKSPACE_ROOT}/website`,
      env: {
        STARLIGHT_INCLUDE_API_DOCS: apiDocs ? '1' : undefined,
        // Building the docs sometimes runs out of memory, so we give it more
        NODE_OPTIONS: '--max_old_space_size=4096',
      },
    }),
)

const websiteCommand = Cli.Command.make('website').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make(
      'dev',
      {
        open: Cli.Options.boolean('open').pipe(Cli.Options.withDefault(false)),
      },
      ({ open }) =>
        cmd(['pnpm', 'astro', 'dev', open ? '--open' : undefined], {
          cwd: `${process.env.WORKSPACE_ROOT}/website`,
        }),
    ),
    websiteBuildCommand,
    Cli.Command.make(
      'deploy',
      {
        // TODO clean up when Effect CLI boolean flag is fixed
        prod: Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false), Cli.Options.optional),
        alias: Cli.Options.text('alias').pipe(Cli.Options.optional),
        site: Cli.Options.text('site').pipe(Cli.Options.optional),
        build: Cli.Options.boolean('build').pipe(Cli.Options.withDefault(false)),
      },
      Effect.fn(function* ({ prod: prodOption, alias: aliasOption, site: siteOption, build: shouldBuild }) {
        if (shouldBuild) {
          yield* websiteBuildCommand.handler({ apiDocs: true })
        }

        const branchName = yield* cmdText('git rev-parse --abbrev-ref HEAD').pipe(
          Effect.map((branchName) => branchName.trim()),
        )

        // TODO rename to `/docs`
        const websitePath = `${process.env.WORKSPACE_ROOT}/website`

        yield* Effect.log(`Branch name: "${branchName}"`)

        const devBranchName = 'wip/0.3.0'

        const site =
          siteOption._tag === 'Some'
            ? siteOption.value
            : branchName === 'main'
              ? 'livestore-docs' // Prod site
              : 'livestore-docs-dev' // Dev site

        // Check if netlify is logged in
        yield* cmd('bunx netlify-cli status', { cwd: websitePath }).pipe(Effect.ignoreLogged)

        const deployArgs = [
          'bunx',
          'netlify-cli',
          'deploy',
          '--no-build',
          `--dir=${websitePath}/dist`,
          `--site=${site}`,
          '--filter=website',
        ]

        yield* Effect.log(`Deploying to "${site}" for draft URL`)
        yield* cmd([...deployArgs], { cwd: websitePath })

        const alias =
          aliasOption._tag === 'Some' ? aliasOption.value : branchName.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase()

        const prod =
          prodOption._tag === 'Some' && prodOption.value === true // TODO clean up when Effect CLI boolean flag is fixed
            ? prodOption.value
            : branchName === 'main' || branchName === devBranchName
              ? true
              : false

        yield* Effect.log(`Deploying to "${site}" ${prod ? 'in prod' : `with alias (${alias})`}`)

        yield* cmd([...deployArgs, prod ? '--prod' : `--alias=${alias}`], { cwd: websitePath })
      }),
    ),
  ]),
)

const circularCommand = Cli.Command.make(
  'circular',
  {},
  Effect.fn(function* () {
    yield* cmd('madge --circular --no-spinner examples/src/*/src packages/*/*/src', { shell: true })
  }),
)

const releaseSnapshotCommand = Cli.Command.make(
  'snapshot',
  {
    gitShaOption: Cli.Options.text('git-sha').pipe(Cli.Options.optional),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ gitShaOption, dryRun }) {
    const originalVersion = yield* Effect.promise(() =>
      import('../packages/@livestore/common/package.json').then((m: any) => m.version as string),
    )

    const gitSha = gitShaOption._tag === 'Some' ? gitShaOption.value : yield* cmdText('git rev-parse HEAD')

    yield* cmd(`pnpm --filter '@livestore/*' exec -- pnpm version '0.0.0-snapshot-${gitSha}' --no-git-tag-version`, {
      shell: true,
    })

    yield* cmd(
      `pnpm --filter '@livestore/*' exec -- pnpm publish --tag=snapshot --no-git-checks ${dryRun ? '--dry-run' : ''}`,
      { shell: true },
    )

    // Rollback package.json versions
    yield* cmd(`pnpm --filter '@livestore/*' exec -- pnpm version '${originalVersion}' --no-git-tag-version`, {
      shell: true,
    })
  }),
)

const releaseCommand = Cli.Command.make('release').pipe(Cli.Command.withSubcommands([releaseSnapshotCommand]))

const examples = fs
  .readdirSync(`${cwd}/examples/src`)
  .filter((entry) => fs.statSync(`${cwd}/examples/src/${entry}`).isDirectory())

const examplesRunCommand = Cli.Command.make(
  'run',
  {
    example: Cli.Args.choice(
      examples.map((example) => [example, example]),
      { name: 'example' },
    ),
  },
  Effect.fn(function* ({ example }) {
    yield* cmd(`pnpm dev`, { cwd: `${cwd}/examples/src/${example}` })
  }),
)

const examplesCommand = Cli.Command.make('examples').pipe(
  Cli.Command.withSubcommands([
    generateExamples.updatePatchesCommand,
    generateExamples.syncExamplesCommand,
    deployExamplesCommand,
    copyTodomvcSrc,
    examplesRunCommand,
  ]),
)

const command = Cli.Command.make('mono').pipe(
  Cli.Command.withSubcommands([
    examplesCommand,
    lintCommand,
    testCommand,
    circularCommand,
    websiteCommand,
    releaseCommand,
  ]),
)

if (import.meta.main) {
  // 'CLI for managing the Livestore monorepo',
  const cli = Cli.Command.run(command, {
    name: 'mono',
    version: '0.0.0',
  })

  const layer = Layer.mergeAll(
    PlatformNode.NodeContext.layer,
    OtelLiveHttp({
      serviceName: 'mono',
      rootSpanName: 'cli',
      rootSpanAttributes: { 'span.label': process.argv.slice(2).join(' ') },
      skipLogUrl: process.argv.join(' ').includes('--completions'),
      traceNodeBootstrap: true,
    }),
  )

  cli(process.argv).pipe(
    Effect.provide(layer),
    Effect.annotateLogs({ thread: 'mono' }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    PlatformNode.NodeRuntime.runMain,
  )
}
