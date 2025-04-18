import { Command, Effect, identity, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'

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
  {
    fix: Cli.Options.boolean('fix').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ fix }: { fix: boolean }) {
    const fixFlag = fix ? '--fix' : ''
    yield* cmd(`eslint scripts examples packages website --ext .ts,.tsx --max-warnings=0 ${fixFlag}`)
    yield* cmd('syncpack lint')
  }),
)

const websiteCommand = Cli.Command.make('website').pipe(
  Cli.Command.withSubcommands([
    Cli.Command.make(
      'dev',
      {},
      Effect.fn(function* () {
        yield* cmd('pnpm astro dev', { cwd: `${process.env.WORKSPACE_ROOT}/website` })
      }),
    ),
    Cli.Command.make(
      'build',
      {
        apiDocs: Cli.Options.boolean('api-docs').pipe(Cli.Options.withDefault(false)),
      },
      Effect.fn(function* ({ apiDocs }) {
        yield* cmd('pnpm astro build', {
          cwd: `${process.env.WORKSPACE_ROOT}/website`,
          env: {
            STARLIGHT_INCLUDE_API_DOCS: apiDocs ? '1' : undefined,
          },
        })
      }),
    ),
  ]),
)

const circularCommand = Cli.Command.make(
  'circular',
  {},
  Effect.fn(function* () {
    yield* cmd('madge --circular --no-spinner examples/src/*/src packages/*/*/src', {
      runInShell: true,
    })
  }),
)

const examplesCommand = Cli.Command.make('examples').pipe(
  Cli.Command.withSubcommands([
    generateExamples.updatePatchesCommand,
    generateExamples.syncExamplesCommand,
    deployExamplesCommand,
  ]),
)

const command = Cli.Command.make('mono').pipe(
  Cli.Command.withSubcommands([examplesCommand, lintCommand, testCommand, circularCommand, websiteCommand]),
)

const cmd = Effect.fn(function* (
  commandStr: string,
  options?: { cwd?: string; runInShell?: boolean; env?: Record<string, string | undefined> },
) {
  const cwd = options?.cwd ?? process.cwd()
  yield* Effect.logDebug(`Running '${commandStr}' in '${cwd}'`)
  const [command, ...args] = commandStr.split(' ')

  return yield* Command.make(command!, ...args).pipe(
    Command.stdout('inherit'), // Stream stdout to process.stdout
    Command.stderr('inherit'), // Stream stderr to process.stderr
    Command.workingDirectory(cwd),
    options?.runInShell ? Command.runInShell(true) : identity,
    Command.env(options?.env ?? {}),
    Command.exitCode,
    Effect.tap((exitCode) => (exitCode === 0 ? Effect.void : Effect.die(`${commandStr} failed`))),
  )
})

if (import.meta.main) {
  // 'CLI for managing the Livestore monorepo',
  const cli = Cli.Command.run(command, {
    name: 'mono',
    version: '0.0.0',
  })

  cli(process.argv).pipe(
    Effect.provide(PlatformNode.NodeContext.layer),
    Effect.annotateLogs({ thread: 'mono' }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    PlatformNode.NodeRuntime.runMain,
  )
}
