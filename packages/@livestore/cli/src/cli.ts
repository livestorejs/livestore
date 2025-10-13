import { Cli } from '@livestore/utils/node'
import { mcpCommand } from './commands/mcp.ts'
import { newProjectCommand } from './commands/new-project.ts'

export const command = Cli.Command.make('livestore', {
  verbose: Cli.Options.boolean('verbose').pipe(Cli.Options.withDefault(false)),
}).pipe(Cli.Command.withSubcommands([mcpCommand, newProjectCommand]))
