import path from 'node:path'

import { UnknownError } from '@livestore/common'
import { CurrentWorkingDirectory, cmd } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Layer, Logger, OtelTracer, References, Schema } from '@livestore/utils/effect'
import { Cli, getFreePort, PlatformNode } from '@livestore/utils/node'
import { LIVESTORE_DEVTOOLS_CHROME_DIST_PATH } from '@local/shared'

const cwd = path.resolve(import.meta.dirname, '..')

const prepareDevtools = (outDir: string) =>
  Effect.gen(function* () {
    yield* cmd([
      'bun',
      path.resolve(cwd, '../../scripts/src/commands/devtools-artifact.ts'),
      'prepare-integration',
      '--manifest',
      path.resolve(cwd, '../../release/devtools-artifact.json'),
      '--out-dir',
      outDir,
    ])
    return { viteEntry: path.join(outDir, 'package/dist/plugin.js'), chromeDir: path.join(outDir, 'chrome') }
  }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))

export const modeOption = Cli.Flag.Literals('mode', ['headless', 'ui', 'dev-server']).pipe(
  Cli.Flag.withDefault('headless'),
)

export const localDevtoolsPreviewOption = Cli.Flag.Boolean('local-devtools-preview').pipe(Cli.Flag.withDefault(false))

type IntegrationTestOptions = {
  readonly mode: 'headless' | 'ui' | 'dev-server'
  readonly localDevtoolsPreview: boolean
}

const viteDevServer = ({
  useWorkspacePort,
  useDevtoolsLocalPreview,
  devtoolsViteEntry,
}: {
  app: 'todomvc'
  useWorkspacePort: boolean
  useDevtoolsLocalPreview: boolean
  devtoolsViteEntry?: string
}) =>
  Effect.gen(function* () {
    const devPort =
      useWorkspacePort === true ? '4444' : yield* getFreePort.pipe(Effect.map(String), UnknownError.mapToUnknownError)

    yield* cmd(`./node_modules/.bin/vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`, {
      env: {
        // Relative to vite config
        TEST_LIVESTORE_SCHEMA_PATH_JSON: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
          './devtools/todomvc/livestore/schema.ts',
        ).pipe(Effect.orDie),
        LSD_DEVTOOLS_LOCAL_PREVIEW: useDevtoolsLocalPreview === true ? '1' : undefined,
        LIVESTORE_DEVTOOLS_VITE_ENTRY: devtoolsViteEntry,
      },
    }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)), Effect.forkScoped)

    return { devPort }
  })

export const runMiscTest = Effect.fn('test:misc')(function* ({ mode, localDevtoolsPreview }: IntegrationTestOptions) {
  yield* Effect.gen(function* () {
    const { devPort } = yield* viteDevServer({
      app: 'todomvc',
      useWorkspacePort: mode === 'dev-server',
      useDevtoolsLocalPreview: localDevtoolsPreview,
    })

    yield* cmd(
      ['pnpm', 'playwright', 'test', mode === 'ui' ? '--ui' : undefined, 'src/tests/playwright/misc-tests.play.ts'],
      {
        env: {
          FORCE_PLAYWRIGHT_VIA_CLI: '1',
          PLAYWRIGHT_SUITE: 'misc',
          LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
          DEV_SERVER_COMMAND: `./node_modules/.bin/vite --config src/tests/playwright/fixtures/vite.config.ts dev --port ${devPort}`,
          PLAYWRIGHT_HEADLESS: mode === 'headless' ? '1' : '0',
          PLAYWRIGHT_UI: mode === 'ui' ? '1' : '0',
        },
      },
    ).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
  }).pipe(Effect.scoped)
})

export const miscTest = Cli.Command.make(
  'misc',
  {
    mode: modeOption,
    localDevtoolsPreview: localDevtoolsPreviewOption,
  },
  runMiscTest,
)

export const runTodomvcTest = Effect.fn('test:todomvc')(function* ({
  mode,
  localDevtoolsPreview,
}: IntegrationTestOptions) {
  yield* Effect.gen(function* () {
    const { devPort } = yield* viteDevServer({
      app: 'todomvc',
      useWorkspacePort: mode === 'dev-server',
      useDevtoolsLocalPreview: localDevtoolsPreview,
    })

    yield* cmd(
      ['pnpm', 'playwright', 'test', mode === 'ui' ? '--ui' : undefined, 'src/tests/playwright/todomvc.play.ts'],
      {
        env: {
          FORCE_PLAYWRIGHT_VIA_CLI: '1',
          PLAYWRIGHT_SUITE: 'todomvc',
          LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
          PLAYWRIGHT_HEADLESS: mode === 'headless' ? '1' : '0',
          PLAYWRIGHT_UI: mode === 'ui' ? '1' : '0',
        },
      },
    ).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
  }).pipe(Effect.scoped)
})

export const todomvcTest = Cli.Command.make(
  'todomvc',
  {
    mode: modeOption,
    localDevtoolsPreview: localDevtoolsPreviewOption,
  },
  runTodomvcTest,
)

export const setupDevtools = Cli.Command.make(
  'setup-devtools',
  {},
  Effect.fn(function* () {
    yield* prepareDevtools(path.dirname(LIVESTORE_DEVTOOLS_CHROME_DIST_PATH))
  }, UnknownError.mapToUnknownError),
)

export const runDevtoolsTest = Effect.fn('test:devtools')(function* ({
  mode,
  localDevtoolsPreview,
}: IntegrationTestOptions) {
  yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    // Keep the extracted plugin beneath this workspace's node_modules so its external
    // dependencies resolve through the same graph as the browser fixture.
    const outDir = yield* fs.makeTempDirectoryScoped({
      directory: path.join(cwd, 'node_modules'),
      prefix: '.devtools-',
    })
    const artifact = yield* prepareDevtools(outDir)
    const { devPort } = yield* viteDevServer({
      app: 'todomvc',
      useWorkspacePort: mode === 'dev-server',
      useDevtoolsLocalPreview: localDevtoolsPreview,
      devtoolsViteEntry: artifact.viteEntry,
    })

    const spanContext = yield* OtelTracer.currentOtelSpan.pipe(
      Effect.map((span) => JSON.stringify(span.spanContext())),
      Effect.orElseSucceed(() => undefined),
    )

    if (mode === 'dev-server') {
      return yield* Effect.never
    } else {
      yield* cmd(
        ['pnpm', 'playwright', 'test', mode === 'ui' ? '--ui' : undefined, 'src/tests/playwright/devtools/*'],
        {
          env: {
            FORCE_PLAYWRIGHT_VIA_CLI: '1',
            PLAYWRIGHT_SUITE: 'devtools',
            PLAYWRIGHT_HEADLESS: mode === 'headless' ? '1' : '0',
            PLAYWRIGHT_UI: mode === 'ui' ? '1' : '0',
            LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT: devPort,
            SPAN_CONTEXT_JSON: spanContext,
            LIVESTORE_DEVTOOLS_CHROME_DIST_PATH: artifact.chromeDir,
          },
        },
      ).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
    }
  }).pipe(Effect.scoped)
})

export const devtoolsTest = Cli.Command.make(
  'devtools',
  {
    mode: modeOption,
    localDevtoolsPreview: localDevtoolsPreviewOption,
  },
  runDevtoolsTest,
)

export const commands = [miscTest, todomvcTest, devtoolsTest, setupDevtools] as const

export const command = Cli.Command.make('integration-misc').pipe(Cli.Command.withSubcommands(commands))

if (import.meta.main === true) {
  Cli.Command.run(command, {
    version: '0.0.0',
  }).pipe(
    Effect.provideService(References.MinimumLogLevel, 'Debug'),
    Effect.provide(Layer.mergeAll(PlatformNode.NodeServices.layer, Logger.layer([Logger.consolePretty()]))),
    PlatformNode.NodeRuntime.runMain,
  )
}
