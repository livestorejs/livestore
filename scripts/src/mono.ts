import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FetchHttpClient, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, OtelLiveHttp } from '@livestore/utils-dev/node'
import { debugCommand } from './commands/debug.ts'
import { docsCommand } from './commands/docs.ts'
import { examplesCommand } from './commands/examples/cli.ts'
import { githubCommand } from './commands/github.ts'
import { lintCommand } from './commands/lint.ts'
import { releaseCommand } from './commands/release.ts'
import { testCommand } from './commands/test-commands.ts'
import { updateDepsCommand } from './commands/update-deps.ts'

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
