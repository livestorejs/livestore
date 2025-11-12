/**
 * Conflicts Command - Manage file sync conflicts
 *
 * TODO: Implement conflict management commands
 * - List all current conflicts with details
 * - Resolve conflicts using various strategies
 * - Interactive conflict resolution
 * - Bulk conflict resolution options
 */

import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

const listCommand = Cli.Command.make('list', {}, () =>
  Effect.gen(function* () {
    yield* Effect.log('🚫 Current File Conflicts')

    // TODO: Query and display conflicts
    yield* Effect.log('🚧 Conflict listing implementation coming soon!')
  }),
)

const resolveCommand = Cli.Command.make(
  'resolve',
  {
    // TODO: Add file ID argument and strategy options
  },
  () =>
    Effect.gen(function* () {
      yield* Effect.log('⚙️ Resolving file conflict...')

      // TODO: Implement conflict resolution
      yield* Effect.log('🚧 Conflict resolution implementation coming soon!')
    }),
)

export const conflictsCommand = Cli.Command.make('conflicts').pipe(
  Cli.Command.withSubcommands([listCommand, resolveCommand]),
)
