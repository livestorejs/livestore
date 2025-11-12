/**
 * File Sync CLI - Main Entry Point
 *
 * Bidirectional file synchronization using LiveStore and Effect
 */

import { liveStoreVersion } from '@livestore/common'
import { Effect, Layer, Logger, LogLevel } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'

// TODO: Import command implementations
// import { syncCommand } from './commands/sync.ts'
// import { watchCommand } from './commands/watch.ts'
// import { statusCommand } from './commands/status.ts'
// import { conflictsCommand } from './commands/conflicts.ts'

// Placeholder commands
const syncCommand = Cli.Command.make('sync', {}, () => Effect.log('🚧 Sync command implementation coming soon!'))

const watchCommand = Cli.Command.make('watch', {}, () => Effect.log('🚧 Watch command implementation coming soon!'))

const statusCommand = Cli.Command.make('status', {}, () => Effect.log('🚧 Status command implementation coming soon!'))

const conflictsCommand = Cli.Command.make('conflicts', {}, () =>
  Effect.log('🚧 Conflicts command implementation coming soon!'),
)

// Main CLI command with subcommands
const command = Cli.Command.make('file-sync').pipe(
  Cli.Command.withSubcommands([syncCommand, watchCommand, statusCommand, conflictsCommand]),
)

// CLI runner
const cli = Cli.Command.run(command, {
  name: 'File Sync CLI',
  version: liveStoreVersion,
})

// Effect runtime layer
const layer = Layer.mergeAll(PlatformNode.NodeContext.layer, Logger.prettyWithThread('file-sync-main'))

// Run the CLI
cli(process.argv).pipe(
  Effect.annotateLogs({ thread: 'file-sync-main' }),
  Logger.withMinimumLogLevel(LogLevel.Info),
  Effect.provide(layer),
  PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: false }),
)
