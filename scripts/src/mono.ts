import { cmd, LivestoreWorkspace, OtelLiveHttp } from '@livestore/utils-dev/node'
import { Effect, FetchHttpClient, Layer, References } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'

import { debugCommand } from './commands/debug.ts'
import { docsCommand } from './commands/docs.ts'
import { examplesCommand } from './commands/examples/cli.ts'
import { githubCommand } from './commands/github.ts'
import { releaseCommand } from './commands/release.ts'
import { testCommand } from './commands/test-commands.ts'
import { updateDepsCommand } from './commands/update-deps.ts'

const circularCommand = Cli.Command.make(
  'circular',
  {},
  Effect.fn(function* () {
    yield* cmd('madge --circular --no-spinner examples/*/src packages/*/*/src', { shell: true }).pipe(
      Effect.provide(LivestoreWorkspace.toCwd()),
    )
  }),
)

const command = Cli.Command.make('mono').pipe(
  Cli.Command.withSubcommands([
    examplesCommand,
    githubCommand,
    testCommand,
    circularCommand,
    docsCommand,
    releaseCommand,
    updateDepsCommand,
    debugCommand,
  ]),
)

if (import.meta.main) {
  const layer = Layer.mergeAll(
    PlatformNode.NodeServices.layer,
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

  Cli.Command.run(command, {
    version: '0.0.0',
  }).pipe(
    Effect.provide(layer),
    Effect.annotateLogs({ thread: 'mono' }),
    Effect.provideService(References.MinimumLogLevel, 'Debug'),
    Effect.scoped,
    PlatformNode.NodeRuntime.runMain,
  )
}
