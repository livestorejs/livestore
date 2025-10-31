/**
 * Sync Command - One-time bidirectional sync
 *
 * TODO: Implement one-time sync between two directories
 * - Parse directory arguments
 * - Initialize LiveStore with file sync schema
 * - Scan both directories and detect differences
 * - Perform sync operations with conflict detection
 * - Report results and exit
 */

import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

// TODO: Add proper options and argument parsing
const dirAOption = Cli.Options.text('dir-a').pipe(Cli.Options.withDescription('First directory to sync'))
const dirBOption = Cli.Options.text('dir-b').pipe(Cli.Options.withDescription('Second directory to sync'))

const dryRunOption = Cli.Options.boolean('dry-run').pipe(
  Cli.Options.withDefault(false),
  Cli.Options.withDescription('Show what would be synced without making changes'),
)

export const syncCommand = Cli.Command.make(
  'sync',
  {
    dirA: dirAOption,
    dirB: dirBOption,
    dryRun: dryRunOption,
  },
  ({ dirA, dirB, dryRun }) =>
    Effect.gen(function* () {
      yield* Effect.log(`🔄 Starting ${dryRun ? 'dry-run ' : ''}sync between:`)
      yield* Effect.log(`  Directory A: ${dirA}`)
      yield* Effect.log(`  Directory B: ${dirB}`)

      // TODO: Implement sync logic
      // 1. Initialize LiveStore with file sync schema
      // 2. Scan both directories
      // 3. Detect differences and conflicts
      // 4. Perform sync operations (if not dry run)
      // 5. Report results

      yield* Effect.log('🚧 Sync implementation coming soon!')
    }).pipe(Effect.withSpan('file-sync:sync-command')),
)
