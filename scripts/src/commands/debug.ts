import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'

const cwd =
  process.env.WORKSPACE_ROOT ??
  (() => {
    throw new Error(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
  })()

// Create biome debug subcommands
const debugBiomeCommand = Cli.Command.make('biome').pipe(
  Cli.Command.withSubcommands([
    // Show statistics and unknown files
    Cli.Command.make(
      'stats',
      {},
      Effect.fn(function* () {
        yield* cmd('biome check . --reporter=summary', { cwd, shell: true })
        yield* Effect.log('\nFiles with unknown handlers:')
        yield* cmd(
          "biome check . --verbose 2>&1 | grep 'files/missingHandler' | awk '{print $1}' | sort | uniq || echo 'None (ignoreUnknown: true is working correctly)'",
          {
            cwd,
            shell: true,
          },
        )
      }),
    ),

    // Debug information (biome rage)
    Cli.Command.make('rage', {}, () => cmd('biome rage', { cwd })),
  ]),
)

// TODO: Add TypeScript debug commands
// const debugTsCommand = Cli.Command.make('ts').pipe(
//   Cli.Command.withSubcommands([
//     // Show TypeScript performance diagnostics
//     Cli.Command.make('perf', {}, () =>
//       cmd('tsc --extendedDiagnostics', { cwd })
//     ),
//
//     // List files and their compilation time
//     Cli.Command.make('trace', {}, () =>
//       cmd('tsc --generateTrace trace-output', { cwd })
//     ),
//
//     // Show why a file is included in compilation
//     Cli.Command.make('why', { file: Cli.Args.text({ name: 'file' }) }, ({ file }) =>
//       cmd(`tsc --explainFiles | grep -A 5 -B 5 "${file}"`, { cwd, shell: true })
//     ),
//
//     // Check for duplicate package issues
//     Cli.Command.make('duplicates', {}, () =>
//       cmd('pnpm dedupe --check', { cwd })
//     ),
//   ])
// )

// TODO: Add dependency debug commands
// const debugDepsCommand = Cli.Command.make('deps').pipe(
//   Cli.Command.withSubcommands([
//     // Show duplicate dependencies
//     Cli.Command.make('duplicates', {}, () =>
//       cmd('pnpm list --depth=0 --parseable | sort | uniq -d', { cwd, shell: true })
//     ),
//
//     // Check for outdated dependencies
//     Cli.Command.make('outdated', {}, () =>
//       cmd('pnpm outdated', { cwd })
//     ),
//   ])
// )

// Create main debug command
export const debugCommand = Cli.Command.make('debug').pipe(
  Cli.Command.withSubcommands([
    debugBiomeCommand,
    // TODO: Add TypeScript debug commands (perf, trace, why, duplicates)
    // TODO: Add dependency debug commands (duplicates, outdated)
  ]),
)
