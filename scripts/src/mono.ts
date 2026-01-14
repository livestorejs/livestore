import { Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, LivestoreWorkspace, OtelLiveHttp } from '@livestore/utils-dev/node'
import { debugCommand } from './commands/debug.ts'
import { docsCommand } from './commands/docs.ts'
import { examplesCommand } from './commands/examples/cli.ts'
import { githubCommand } from './commands/github.ts'
import { lintCommand } from './commands/lint.ts'
import { releaseCommand } from './commands/release.ts'
import { testCommand } from './commands/test-commands.ts'
import { updateDepsCommand } from './commands/update-deps.ts'

const tsCommand = Cli.Command.make(
  'ts',
  {
    watch: Cli.Options.boolean('watch').pipe(Cli.Options.withDefault(false)),
    clean: Cli.Options.boolean('clean').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Clean build artifacts before compilation'),
    ),
    noCheck: Cli.Options.boolean('no-check').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Disable full type checking (only critical parse and emit errors will be reported)'),
    ),
  },
  Effect.fn(function* ({ watch, clean, noCheck }) {
    if (clean) {
      yield* cmd('tsc --build tsconfig.dev.json --clean').pipe(Effect.provide(LivestoreWorkspace.toCwd()))
    }

    const flags = ['--build', 'tsconfig.dev.json', noCheck && '--noCheck', watch && '--watch'].filter(Boolean).join(' ')

    yield* cmd(`tsc ${flags}`).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
    // TODO bring back when implemented https://github.com/livestorejs/livestore/issues/477
    // yield* cmd('tsc --build tsconfig.examples.json', { cwd })
  }),
)

const circularCommand = Cli.Command.make(
  'circular',
  {},
  Effect.fn(function* () {
    yield* cmd('bunx madge --circular --no-spinner examples/*/src packages/*/*/src', { shell: true }).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
    )
  }),
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
    LivestoreWorkspace.live,
  )

  cli(process.argv).pipe(
    Effect.provide(layer),
    Effect.annotateLogs({ thread: 'mono' }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.scoped,
    PlatformNode.NodeRuntime.runMain,
  )
}
