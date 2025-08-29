import path from 'node:path'

import { UnexpectedError } from '@livestore/common'
import type { CommandExecutor, Option, PlatformError } from '@livestore/utils/effect'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel, OtelTracer } from '@livestore/utils/effect'
import { Cli, getFreePort, PlatformNode } from '@livestore/utils/node'
import { type CmdError, cmd } from '@livestore/utils-dev/node'
import { LIVESTORE_DEVTOOLS_CHROME_DIST_PATH } from '@local/shared'
import { downloadChromeExtension } from './download-chrome-extension.ts'

const cwd = path.resolve(import.meta.dirname, '..')

const modeOption = Cli.Options.choice('mode', ['headless', 'ui', 'dev-server']).pipe(
  Cli.Options.withDefault('headless'),
)

export const localDevtoolsPreviewOption = Cli.Options.boolean('local-devtools-preview').pipe(
  Cli.Options.withDefault(false),
)

const viteDevServer = ({
  useWorkspacePort,
  useDevtoolsLocalPreview,
}: {
  app: 'todomvc'
  useWorkspacePort: boolean
  useDevtoolsLocalPreview: boolean
}) =>
  Effect.gen(function* () {
    const devPort = useWorkspacePort
      ? '4444'
      : yield* getFreePort.pipe(Effect.map(String), UnexpectedError.mapToUnexpectedError)

    yield* cmd(`vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`, {
      env: {
        // Relative to vite config
        TEST_LIVESTORE_SCHEMA_PATH_JSON: JSON.stringify('./devtools/todomvc/livestore/schema.ts'),
        LSD_DEVTOOLS_LOCAL_PREVIEW: useDevtoolsLocalPreview ? '1' : undefined,
      },
      cwd,
    }).pipe(Effect.forkScoped)

    return { devPort }
  })

export const miscTest: Cli.Command.Command<
  'misc',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError | CmdError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
    readonly localDevtoolsPreview: boolean
  }
> = Cli.Command.make(
  'misc',
  {
    mode: modeOption,
    localDevtoolsPreview: localDevtoolsPreviewOption,
  },
  Effect.fn(
    function* ({ mode, localDevtoolsPreview }) {
      const { devPort } = yield* viteDevServer({
        app: 'todomvc',
        useWorkspacePort: mode === 'dev-server',
        useDevtoolsLocalPreview: localDevtoolsPreview,
      })

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

export const todomvcTest: Cli.Command.Command<
  'todomvc',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError | CmdError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
    readonly localDevtoolsPreview: boolean
  }
> = Cli.Command.make(
  'todomvc',
  {
    mode: modeOption,
    localDevtoolsPreview: localDevtoolsPreviewOption,
  },
  Effect.fn(
    function* ({ mode, localDevtoolsPreview }) {
      const { devPort } = yield* viteDevServer({
        app: 'todomvc',
        useWorkspacePort: mode === 'dev-server',
        useDevtoolsLocalPreview: localDevtoolsPreview,
      })

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

export const setupDevtools: Cli.Command.Command<
  'setup-devtools',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError,
  {}
> = Cli.Command.make(
  'setup-devtools',
  {},
  Effect.fn(function* () {
    const targetDir = LIVESTORE_DEVTOOLS_CHROME_DIST_PATH

    yield* downloadChromeExtension({
      targetDir,
    }).pipe(Effect.provide(Layer.mergeAll(FetchHttpClient.layer, PlatformNode.NodeContext.layer)))

    yield* Effect.logInfo(`Chrome extension downloaded to ${targetDir}`)
  }, UnexpectedError.mapToUnexpectedError),
)

export const devtoolsTest: Cli.Command.Command<
  'devtools',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError | CmdError,
  {
    readonly mode: 'headless' | 'ui' | 'dev-server'
    readonly localDevtoolsPreview: boolean
  }
> = Cli.Command.make(
  'devtools',
  {
    mode: modeOption,
    localDevtoolsPreview: localDevtoolsPreviewOption,
  },
  Effect.fn(
    function* ({ mode, localDevtoolsPreview }) {
      const { devPort } = yield* viteDevServer({
        app: 'todomvc',
        useWorkspacePort: mode === 'dev-server',
        useDevtoolsLocalPreview: localDevtoolsPreview,
      })

      const spanContext = yield* OtelTracer.currentOtelSpan.pipe(
        Effect.map((span) => JSON.stringify(span.spanContext())),
        Effect.catchAll(() => Effect.succeed(undefined)),
      )

      if (mode === 'dev-server') {
        return yield* Effect.never
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

export const commands = [miscTest, todomvcTest, devtoolsTest, setupDevtools] as const

export const command: Cli.Command.Command<
  'integration-misc',
  CommandExecutor.CommandExecutor,
  UnexpectedError | PlatformError.PlatformError | CmdError,
  {
    readonly subcommand: Option.Option<{ readonly headless: boolean } | {}>
  }
> = Cli.Command.make('integration-misc').pipe(Cli.Command.withSubcommands(commands))

if (import.meta.main) {
  const cli = Cli.Command.run(command, {
    name: 'Run Tests',
    version: '0.0.0',
  })

  cli(process.argv).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Layer.mergeAll(PlatformNode.NodeContext.layer, Logger.prettyWithThread('cli-run-tests'))),
    PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }),
  )
}
