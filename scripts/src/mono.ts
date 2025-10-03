import fs from 'node:fs'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText, OtelLiveHttp } from '@livestore/utils-dev/node'
import { debugCommand } from './commands/debug.ts'
import { docsCommand } from './commands/docs.ts'
import { githubCommand } from './commands/github.ts'
import { lintCommand } from './commands/lint.ts'
import { testCommand } from './commands/test-commands.ts'
import { updateDepsCommand } from './commands/update-deps.ts'
import { copyTodomvcSrc } from './examples/copy-examples.ts'
import { command as deployExamplesCommand } from './examples/deploy-examples.ts'

const cwd =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)

const tsCommand = Cli.Command.make(
  'ts',
  {
    watch: Cli.Options.boolean('watch').pipe(Cli.Options.withDefault(false)),
    clean: Cli.Options.boolean('clean').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Clean build artifacts before compilation'),
    ),
  },
  Effect.fn(function* ({ watch, clean }) {
    if (clean) {
      yield* cmd(
        'find {examples,packages,tests,docs} -path "*node_modules*" -prune -o \\( -name "dist" -type d -a -not -path "*/wa-sqlite/dist" -o -name "*.tsbuildinfo" \\) -exec rm -rf {} +',
        { cwd, shell: true },
      )
    }

    if (watch) {
      yield* cmd('tsc --build tsconfig.dev.json --watch', { cwd })
    } else {
      yield* cmd('tsc --build tsconfig.dev.json', { cwd })
      // TODO bring back when implemented https://github.com/livestorejs/livestore/issues/477
      // yield* cmd('tsc --build tsconfig.examples.json', { cwd })
    }
  }),
)

const circularCommand = Cli.Command.make(
  'circular',
  {},
  Effect.fn(function* () {
    yield* cmd('madge --circular --no-spinner examples/*/src packages/*/*/src', { shell: true })
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
      import('../../packages/@livestore/common/package.json').then((m: any) => m.version as string),
    )

    const gitSha = gitShaOption._tag === 'Some' ? gitShaOption.value : yield* cmdText('git rev-parse HEAD')
    const filterStr = '--filter @livestore/* --filter !@livestore/effect-playwright'

    const snapshotVersion = `0.0.0-snapshot-${gitSha}`

    const versionFilePath = `${cwd}/packages/@livestore/common/src/version.ts`
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(originalVersion, snapshotVersion),
    )

    yield* cmd(`pnpm ${filterStr} exec -- pnpm version '${snapshotVersion}' --no-git-tag-version`, {
      shell: true,
    })

    yield* cmd(`pnpm ${filterStr} exec -- pnpm publish --tag=snapshot --no-git-checks ${dryRun ? '--dry-run' : ''}`, {
      shell: true,
    })

    // Rollback package.json versions
    yield* cmd(`pnpm ${filterStr} exec -- pnpm version '${originalVersion}' --no-git-tag-version`, {
      shell: true,
    })

    // Rollback version.ts
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(snapshotVersion, originalVersion),
    )
  }),
)

const releaseCommand = Cli.Command.make('release').pipe(Cli.Command.withSubcommands([releaseSnapshotCommand]))

const examples = fs
  .readdirSync(`${cwd}/examples`)
  .filter((entry) => fs.statSync(`${cwd}/examples/${entry}`).isDirectory())

const examplesRunCommand = Cli.Command.make(
  'run',
  {
    example: Cli.Args.choice(
      examples.map((example) => [example, example]),
      { name: 'example' },
    ),
  },
  Effect.fn(function* ({ example }) {
    yield* cmd(`pnpm dev`, { cwd: `${cwd}/examples/${example}` })
  }),
)

const examplesCommand = Cli.Command.make('examples').pipe(
  Cli.Command.withSubcommands([deployExamplesCommand, copyTodomvcSrc, examplesRunCommand]),
)

const command = Cli.Command.make('mono').pipe(
  Cli.Command.withSubcommands([
    examplesCommand,
    lintCommand,
    githubCommand,
    testCommand,
    tsCommand,
    circularCommand,
    docsCommand,
    releaseCommand,
    updateDepsCommand,
    debugCommand,
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
    FetchHttpClient.layer,
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
