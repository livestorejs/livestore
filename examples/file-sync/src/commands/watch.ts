/**
 * Watch Command - Continuous bidirectional sync
 *
 * TODO: Implement continuous file watching and sync
 * - Set up file system watchers for both directories
 * - Handle file change events and transform to LiveStore events
 * - Perform ongoing bidirectional sync until interrupted
 * - Graceful shutdown on SIGINT/SIGTERM
 */

import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

export const watchCommand = Cli.Command.make(
  'watch',
  {
    // TODO: Add directory arguments and options
  },
  () =>
    Effect.gen(function* () {
      yield* Effect.log('👁 Starting continuous file sync watching...')

      // TODO: Implement watch logic
      // 1. Initialize LiveStore with file sync schema
      // 2. Set up file system watchers using FileWatcherService
      // 3. Start continuous sync loop
      // 4. Handle graceful shutdown

      yield* Effect.log('🚧 Watch implementation coming soon!')
    }).pipe(Effect.withSpan('file-sync:watch-command')),
)
