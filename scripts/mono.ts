import { shouldNeverHappen } from '@livestore/utils'
import { Command, Effect, identity, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'

import { command as deployExamplesCommand } from './deploy-examples.js'
import * as generateExamples from './generate-examples.js'

const testCommand = Cli.Command.make(
  'test',
  {},
  Effect.fn(function* () {
    yield* cmd('vitest')
  }),
)

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

const cmd = Effect.fn('cmd')(function* (
  commandStr: string,
  options?: { cwd?: string; shell?: boolean; env?: Record<string, string | undefined> },
) {
  const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
  const [command, ...args] = commandStr.split(' ')

  yield* Effect.logDebug(`Running '${commandStr}' in '${cwd}'`)
  yield* Effect.annotateCurrentSpan({ 'span.label': commandStr, commandStr, cwd })

  return yield* Command.make(command!, ...args).pipe(
    Command.stdout('inherit'), // Stream stdout to process.stdout
    Command.stderr('inherit'), // Stream stderr to process.stderr
    Command.workingDirectory(cwd),
    options?.shell ? Command.runInShell(true) : identity,
    Command.env(options?.env ?? {}),
    Command.exitCode,
    Effect.tap((exitCode) => (exitCode === 0 ? Effect.void : Effect.die(`${commandStr} failed`))),
  )
})

const cmdText = Effect.fn('cmdTextc')(function* (
  commandStr: string,
  options?: { cwd?: string; runInShell?: boolean; env?: Record<string, string | undefined> },
) {
  const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
  const [command, ...args] = commandStr.split(' ')

  yield* Effect.logDebug(`Running '${commandStr}' in '${cwd}'`)
  yield* Effect.annotateCurrentSpan({ 'span.label': commandStr, commandStr, cwd })

  return yield* Command.make(command!, ...args).pipe(
    Command.workingDirectory(cwd),
    options?.runInShell ? Command.runInShell(true) : identity,
    Command.env(options?.env ?? {}),
    Command.string,
  )
})

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
