import { UnexpectedError } from '@livestore/common'
import { isNotUndefined, shouldNeverHappen } from '@livestore/utils'
import type { CommandExecutor, Option, PlatformError } from '@livestore/utils/effect'
import { Command, Effect, identity, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, getFreePort, PlatformNode } from '@livestore/utils/node'

const cwd = import.meta.dirname + '/..'

const unitTest: Cli.Command.Command<
  'unit',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly headless: boolean
  }
> = Cli.Command.make(
  'unit',
  {
    headless: Cli.Options.boolean('headless').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ headless }) {
    const devPort = yield* getFreePort.pipe(Effect.map(String), UnexpectedError.mapToUnexpectedError)
    yield* cmd(['pnpm', 'playwright', 'test', 'src/tests/playwright/unit-tests.play.ts'], {
      env: {
        PLAYWRIGHT_SUITE: 'unit',
        DEV_SERVER_PORT: devPort,
        DEV_SERVER_COMMAND: `vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`,
        PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
      },
      cwd,
    })
  }),
)

const nodeSyncTest: Cli.Command.Command<
  'node-sync',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {}
> = Cli.Command.make(
  'node-sync',
  {},
  Effect.fn(function* () {
    yield* cmd(['pnpm', 'vitest', 'src/tests/node-sync/node-sync.test.ts'], {
      cwd,
      env: { CI: '1' },
    })
  }),
)

const todomvcTest: Cli.Command.Command<
  'todomvc',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly headless: boolean
  }
> = Cli.Command.make(
  'todomvc',
  {
    headless: Cli.Options.boolean('headless').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ headless }) {
    yield* cmd(['pnpm', 'playwright', 'test', 'src/tests/playwright/todomvc.play.ts'], {
      cwd,
      env: {
        PLAYWRIGHT_SUITE: 'todomvc',
        DEV_SERVER_PORT: yield* getFreePort.pipe(Effect.map(String), UnexpectedError.mapToUnexpectedError),
        DEV_SERVER_COMMAND: 'pnpm vite dev',
        PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
      },
    })
  }),
)

const devtoolsTest: Cli.Command.Command<
  'devtools',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly headless: boolean
    readonly ui: boolean
  }
> = Cli.Command.make(
  'devtools',
  {
    headless: Cli.Options.boolean('headless').pipe(Cli.Options.withDefault(false)),
    ui: Cli.Options.boolean('ui').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ headless, ui }) {
    const devPort = yield* getFreePort.pipe(Effect.map(String), UnexpectedError.mapToUnexpectedError)
    yield* cmd(['pnpm', 'playwright', 'test', ui ? '--ui' : undefined, 'src/tests/playwright/devtools/*'], {
      cwd,
      env: {
        PLAYWRIGHT_SUITE: 'devtools',
        PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
        DEV_SERVER_PORT: devPort,
        DEV_SERVER_COMMAND: `PORT=${devPort} pnpm --filter livestore-example-src-web-todomvc dev`,
      },
    })
  }),
)

export const commands = [unitTest, nodeSyncTest, todomvcTest, devtoolsTest] as const

export const command: Cli.Command.Command<
  'run',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly subcommand: Option.Option<{ readonly headless: boolean } | {}>
  }
> = Cli.Command.make(
  'run',
  {},
  Effect.fn(function* () {
    yield* Effect.all(
      [
        unitTest.handler({ headless: true }),
        nodeSyncTest.handler({}),
        todomvcTest.handler({ headless: true }),
        devtoolsTest.handler({ headless: true, ui: false }),
      ],
      { concurrency: 'unbounded' },
    )
  }),
).pipe(Cli.Command.withSubcommands([unitTest, nodeSyncTest, todomvcTest, devtoolsTest]))

if (import.meta.main) {
  const cli = Cli.Command.run(command, {
    name: 'Run Tests',
    version: '0.0.0',
  })

  cli(process.argv).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(PlatformNode.NodeContext.layer),
    Effect.provide(Logger.prettyWithThread('cli-run-tests')),
    PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }),
  )
}

const cmd = Effect.fn('cmd')(function* (
  commandInput: string | (string | undefined)[],
  options?: { cwd?: string; shell?: boolean; env?: Record<string, string | undefined> },
) {
  const cwd = options?.cwd ?? process.env.WORKSPACE_ROOT ?? shouldNeverHappen('WORKSPACE_ROOT is not set')
  const [command, ...args] = Array.isArray(commandInput) ? commandInput.filter(isNotUndefined) : commandInput.split(' ')
  const commandStr = [command, ...args].join(' ')

  yield* Effect.logDebug(`Running '${commandStr}' in '${cwd}'`)
  yield* Effect.annotateCurrentSpan({ 'span.label': commandStr, commandStr, cwd })

  return yield* Command.make(command!, ...args).pipe(
    Command.stdout('inherit'), // Stream stdout to process.stdout
    Command.stderr('inherit'), // Stream stderr to process.stderr
    Command.workingDirectory(cwd),
    options?.shell ? Command.runInShell(true) : identity,
    Command.env({ ...options?.env }),
    Command.exitCode,
    Effect.tap((exitCode) => (exitCode === 0 ? Effect.void : Effect.die(`${commandStr} failed`))),
  )
})
