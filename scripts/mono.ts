import { Command, Effect, identity, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'

import { command as generateExamplesCommand } from './generate-examples.js'

const testCommand = Cli.Command.make(
  'test',
  {},
  Effect.fn(function* () {
    yield* cmd('vitest')
  }),
)

const lintCheck = Cli.Command.make(
  'check',
  {},
  Effect.fn(function* () {
    yield* cmd('eslint examples packages website --ext .ts,.tsx --max-warnings=0')
    yield* cmd('syncpack lint')
  }),
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

const lintCommand = Cli.Command.make('lint').pipe(Cli.Command.withSubcommands([lintCheck]))

const command = Cli.Command.make('mono').pipe(
  Cli.Command.withSubcommands([generateExamplesCommand, lintCommand, testCommand, circularCommand]),
)

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

const cmd = Effect.fn(function* (commandStr: string, options?: { cwd?: string; runInShell?: boolean }) {
  const cwd = options?.cwd ?? process.cwd()
  yield* Effect.logDebug(`Running '${commandStr}' in '${cwd}'`)
  const [command, ...args] = commandStr.split(' ')

  return yield* Command.make(command!, ...args).pipe(
    Command.stdout('inherit'), // Stream stdout to process.stdout
    Command.stderr('inherit'), // Stream stderr to process.stderr
    Command.workingDirectory(cwd),
    options?.runInShell ? Command.runInShell(true) : identity,
    Command.exitCode,
    Effect.tap((exitCode) => (exitCode === 0 ? Effect.void : Effect.die(`${commandStr} failed`))),
  )
})
