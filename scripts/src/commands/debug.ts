import { cmd, LivestoreWorkspace } from '@livestore/utils-dev/node'
import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

// Create biome debug subcommands
const debugBiomeCommand = Cli.Command.make('biome').pipe(
  Cli.Command.withSubcommands([
    // Show statistics and unknown files
    Cli.Command.make(
      'stats',
      {},
      Effect.fn(function* () {
        yield* cmd('biome check . --reporter=summary', { shell: true }).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
        yield* Effect.log('\nFiles with unknown handlers:')
        yield* cmd(
          "biome check . --verbose 2>&1 | grep 'files/missingHandler' | awk '{print $1}' | sort | uniq || echo 'None (ignoreUnknown: true is working correctly)'",
          {
            shell: true,
          },
        ).pipe(Effect.provide(LivestoreWorkspace.toCwd()))
      }),
    ),

    // Debug information (biome rage)
    Cli.Command.make('rage', {}, () => cmd('biome rage').pipe(Effect.provide(LivestoreWorkspace.toCwd()))),
  ]),
)

// TypeScript debug commands
const debugTsCommand = Cli.Command.make('ts').pipe(
  Cli.Command.withSubcommands([
    // Show TypeScript performance diagnostics
    Cli.Command.make('perf', {}, () =>
      cmd('tsc --extendedDiagnostics').pipe(Effect.provide(LivestoreWorkspace.toCwd())),
    ),

    // List files and their compilation time
    Cli.Command.make('trace', {}, () =>
      cmd('tsc --generateTrace trace-output').pipe(Effect.provide(LivestoreWorkspace.toCwd())),
    ),

    // Show why a file is included in compilation
    Cli.Command.make('why', { file: Cli.Args.text({ name: 'file' }) }, ({ file }) =>
      cmd(`tsc --explainFiles | grep -A 5 -B 5 "${file}"`, { shell: true }).pipe(
        Effect.provide(LivestoreWorkspace.toCwd()),
      ),
    ),

    // Check for duplicate package issues
    Cli.Command.make('duplicates', {}, () =>
      cmd('pnpm dedupe --check').pipe(Effect.provide(LivestoreWorkspace.toCwd())),
    ),
  ]),
)

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
export const debugCommand = Cli.Command.make('debug').pipe(
  Cli.Command.withSubcommands([debugBiomeCommand, debugTsCommand, debugDepsCommand]),
)
