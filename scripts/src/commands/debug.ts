import { cmd, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

// Dependency debug commands
const debugDepsCommand = Cli.Command.make('deps').pipe(
  Cli.Command.withSubcommands([
    // Show duplicate dependencies
    Cli.Command.make('duplicates', {}, () =>
      cmd('pnpm list --depth=0 --parseable | sort | uniq -d', { shell: true }).pipe(
        Effect.provide(LivestoreWorkspace.toCwd()),
      ),
    ),

    // Check for outdated dependencies
    Cli.Command.make('outdated', {}, () => cmd('pnpm outdated').pipe(Effect.provide(LivestoreWorkspace.toCwd()))),
  ]),
)

// Create main debug command
export const debugCommand = Cli.Command.make('debug').pipe(Cli.Command.withSubcommands([debugDepsCommand]))
