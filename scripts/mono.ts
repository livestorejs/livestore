import { Effect, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText, OtelLiveHttp } from '@livestore/utils-dev/node'
import * as integrationTests from '@local/tests-integration/run-tests'

import { command as deployExamplesCommand } from './deploy-examples.js'
import * as generateExamples from './generate-examples.js'

const testCommand = Cli.Command.make(
  'test',
  {},
  Effect.fn(function* () {
    yield* cmd('vitest')
    yield* integrationTests.runAll.handler({})
  }),
).pipe(Cli.Command.withSubcommands([integrationTests.command]))

const lintCommand = Cli.Command.make(
  'lint',
  { fix: Cli.Options.boolean('fix').pipe(Cli.Options.withDefault(false)) },
  Effect.fn(function* ({ fix }) {
    const fixFlag = fix ? '--fix' : ''
    yield* cmd(`eslint scripts examples packages website --ext .ts,.tsx --max-warnings=0 ${fixFlag}`, { shell: true })
    if (fix) {
      yield* cmd('syncpack format')
    }

    yield* cmd('syncpack lint')
  }),
)

const websiteCommand = Cli.Command.make('website').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make('dev', {}, () => cmd('pnpm astro dev', { cwd: `${process.env.WORKSPACE_ROOT}/website` })),
    Cli.Command.make(
      'build',
      { apiDocs: Cli.Options.boolean('api-docs').pipe(Cli.Options.withDefault(false)) },
      ({ apiDocs }) =>
        cmd('pnpm astro build', {
          cwd: `${process.env.WORKSPACE_ROOT}/website`,
          env: { STARLIGHT_INCLUDE_API_DOCS: apiDocs ? '1' : undefined },
        }),
    ),
    Cli.Command.make(
      'deploy',
      {
        // TODO clean up when Effect CLI boolean flag is fixed
        prod: Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false), Cli.Options.optional),
        alias: Cli.Options.text('alias').pipe(Cli.Options.optional),
        site: Cli.Options.text('site').pipe(Cli.Options.optional),
      },
      Effect.fn(function* ({ prod: prodOption, alias: aliasOption, site: siteOption }) {
        const branchName = yield* cmdText('git rev-parse --abbrev-ref HEAD').pipe(
          Effect.map((branchName) => branchName.trim()),
        )

        yield* Effect.log(`Branch name: "${branchName}"`)

        const devBranchName = 'wip/0.3.0'

        const site =
          siteOption._tag === 'Some'
            ? siteOption.value
            : branchName === 'main'
              ? 'livestore-website' // Prod site
              : 'livestore-website-next' // Dev site

        const deployArgs = ['bunx', 'netlify-cli', 'deploy', '--dir=dist', `--site=${site}`, '--filter=website']

        yield* Effect.log(`Deploying to "${site}" for draft URL`)
        yield* cmd([...deployArgs], { cwd: `${process.env.WORKSPACE_ROOT}/website` })

        const alias =
          aliasOption._tag === 'Some' ? aliasOption.value : branchName.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase()

        const prod =
          prodOption._tag === 'Some' && prodOption.value === true // TODO clean up when Effect CLI boolean flag is fixed
            ? prodOption.value
            : branchName === 'main' || branchName === devBranchName
              ? true
              : false

        yield* Effect.log(`Deploying to "${site}" ${prod ? 'in prod' : `with alias (${alias})`}`)

        yield* cmd([...deployArgs, prod ? '--prod' : `--alias=${alias}`], {
          cwd: `${process.env.WORKSPACE_ROOT}/website`,
        })
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

const examplesCommand = Cli.Command.make('examples').pipe(
  Cli.Command.withSubcommands([
    generateExamples.updatePatchesCommand,
    generateExamples.syncExamplesCommand,
    deployExamplesCommand,
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
