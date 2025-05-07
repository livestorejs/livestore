import path from 'node:path'

import { UnexpectedError } from '@livestore/common'
import type { CommandExecutor, Option, PlatformError } from '@livestore/utils/effect'
import { Effect, Logger, LogLevel, OtelTracer } from '@livestore/utils/effect'
import { Cli, getFreePort, PlatformNode } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'

const cwd = path.resolve(import.meta.dirname, '..')

const modeOption = Cli.Options.choice('mode', ['headless', 'ui', 'dev-server']).pipe(
  Cli.Options.withDefault('headless'),
)

const viteDevServer = (app: 'todomvc', useWorkspacePort: boolean) =>
  Effect.gen(function* () {
    const devPort = useWorkspacePort
      ? '4444'
      : yield* getFreePort.pipe(Effect.map(String), UnexpectedError.mapToUnexpectedError)

    yield* cmd(`vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`, {
      env: {
        // Relative to vite config
        TEST_LIVESTORE_SCHEMA_PATH_JSON: JSON.stringify('./devtools/todomvc/livestore/schema.ts'),
      },
      cwd,
    }).pipe(Effect.forkScoped)

    return { devPort }
  })

export const miscTest: Cli.Command.Command<
  'misc',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
  }
> = Cli.Command.make(
  'misc',
  {
    mode: modeOption,
  },
  Effect.fn(
    function* ({ mode }) {
      const { devPort } = yield* viteDevServer('todomvc', mode === 'dev-server')

      yield* cmd(
        ['pnpm', 'playwright', 'test', mode === 'ui' ? '--ui' : undefined, 'src/tests/playwright/misc-tests.play.ts'],
        {
          env: {
            PLAYWRIGHT_SUITE: 'misc',
            LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
            DEV_SERVER_COMMAND: `vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`,
            PLAYWRIGHT_HEADLESS: mode === 'headless' ? '1' : '0',
            PLAYWRIGHT_UI: mode === 'ui' ? '1' : '0',
          },
          cwd,
        },
      )
    },
    Effect.withSpan('test:misc'),
    Effect.scoped,
  ),
)

export const nodeSyncTest: Cli.Command.Command<
  'node-sync',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {}
> = Cli.Command.make(
  'node-sync',
  {},
  Effect.fn(function* () {
    yield* cmd(['vitest', 'src/tests/node-sync/node-sync.test.ts'], {
      cwd,
      env: { CI: '1' },
    })
  }),
)

export const todomvcTest: Cli.Command.Command<
  'todomvc',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
  }
> = Cli.Command.make(
  'todomvc',
  {
    mode: modeOption,
  },
  Effect.fn(
    function* ({ mode }) {
      const { devPort } = yield* viteDevServer('todomvc', mode === 'dev-server')

      yield* cmd(
        ['pnpm', 'playwright', 'test', mode === 'ui' ? '--ui' : undefined, 'src/tests/playwright/todomvc.play.ts'],
        {
          cwd,
          env: {
            PLAYWRIGHT_SUITE: 'todomvc',
            LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
            PLAYWRIGHT_HEADLESS: mode === 'headless' ? '1' : '0',
            PLAYWRIGHT_UI: mode === 'ui' ? '1' : '0',
          },
        },
      )
    },
    Effect.withSpan('test:todomvc'),
    Effect.scoped,
  ),
)

export const devtoolsTest: Cli.Command.Command<
  'devtools',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
  }
> = Cli.Command.make(
  'devtools',
  {
    mode: modeOption,
  },
  Effect.fn(
    function* ({ mode }) {
      const { devPort } = yield* viteDevServer('todomvc', mode === 'dev-server')

      const spanContext = yield* OtelTracer.currentOtelSpan.pipe(
        Effect.map((span) => JSON.stringify(span.spanContext())),
        Effect.catchAll(() => Effect.succeed(undefined)),
      )

      if (mode === 'dev-server') {
        yield* Effect.never
      } else {
        yield* cmd(
          ['pnpm', 'playwright', 'test', mode === 'ui' ? '--ui' : undefined, 'src/tests/playwright/devtools/*'],
          {
            cwd,
            env: {
              PLAYWRIGHT_SUITE: 'devtools',
              PLAYWRIGHT_HEADLESS: mode === 'headless' ? '1' : '0',
              PLAYWRIGHT_UI: mode === 'ui' ? '1' : '0',
              LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
              SPAN_CONTEXT_JSON: spanContext,
            },
          },
        )
      }
    },
    Effect.withSpan('test:devtools'),
    Effect.scoped,
  ),
)

export const runAll: Cli.Command.Command<
  'all',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly concurrency: 'sequential' | 'parallel'
  }
> = Cli.Command.make(
  'all',
  {
    concurrency: Cli.Options.choice('concurrency', ['sequential', 'parallel']).pipe(
      Cli.Options.withDefault('parallel'),
    ),
  },
  Effect.fn(function* ({ concurrency }) {
    yield* Effect.all(
      [
        miscTest.handler({ mode: 'headless' }),
        nodeSyncTest.handler({}),
        todomvcTest.handler({ mode: 'headless' }),
        devtoolsTest.handler({ mode: 'headless' }),
      ],
      { concurrency: concurrency === 'parallel' ? 'unbounded' : 1 },
    )
  }),
)

export const commands = [miscTest, nodeSyncTest, todomvcTest, devtoolsTest, runAll] as const

export const command: Cli.Command.Command<
  'integration',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly subcommand: Option.Option<{ readonly headless: boolean } | {}>
  }
> = Cli.Command.make('integration').pipe(Cli.Command.withSubcommands(commands))

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
