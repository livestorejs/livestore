import path from 'node:path'

import { UnexpectedError } from '@livestore/common'
import type { CommandExecutor, Option, PlatformError } from '@livestore/utils/effect'
import { Effect, Logger, LogLevel, OtelTracer, Schema } from '@livestore/utils/effect'
import { Cli, getFreePort, PlatformNode } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'

const cwd = path.resolve(import.meta.dirname, '..')

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
  Effect.fn(
    function* ({ headless }) {
      const { devPort } = yield* viteDevServer('todomvc', false)

      yield* cmd(['pnpm', 'playwright', 'test', 'src/tests/playwright/unit-tests.play.ts'], {
        env: {
          PLAYWRIGHT_SUITE: 'unit',
          LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
          DEV_SERVER_COMMAND: `vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`,
          PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
        },
        cwd,
      })
    },
    Effect.withSpan('test:unit'),
    Effect.scoped,
  ),
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
  Effect.fn(
    function* ({ headless }) {
      const { devPort } = yield* viteDevServer('todomvc', false)

      yield* cmd(['pnpm', 'playwright', 'test', 'src/tests/playwright/todomvc.play.ts'], {
        cwd,
        env: {
          PLAYWRIGHT_SUITE: 'todomvc',
          LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
          PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
        },
      })
    },
    Effect.withSpan('test:todomvc'),
    Effect.scoped,
  ),
)

const devtoolsTest: Cli.Command.Command<
  'devtools',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
  }
> = Cli.Command.make(
  'devtools',
  {
    // headless: Cli.Options.boolean('headless').pipe(Cli.Options.withDefault(false)),
    // ui: Cli.Options.boolean('ui').pipe(Cli.Options.withDefault(false)),
    mode: Cli.Options.text('mode').pipe(Cli.Options.withSchema(Schema.Literal('headless', 'ui', 'dev-server'))),
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
        devtoolsTest.handler({ mode: 'headless' }),
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
