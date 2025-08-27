import { Effect } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { mcpCommand } from './commands/mcp.ts'
import { newProjectCommand } from './commands/new-project.ts'

const helloCommand = Cli.Command.make(
  'hello',
  {
    name: Cli.Options.text('name').pipe(Cli.Options.withDefault('World')),
  },
  Effect.fn(function* ({ name }: { name: string }) {
    yield* Effect.log(`Hello, ${name}! 🎉`)
  }),
)

export const command = Cli.Command.make('livestore', {
  verbose: Cli.Options.boolean('verbose').pipe(Cli.Options.withDefault(false)),
}).pipe(Cli.Command.withSubcommands([helloCommand, mcpCommand, newProjectCommand]))

if (import.meta.main) {
}
