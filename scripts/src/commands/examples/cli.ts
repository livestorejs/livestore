import fs from 'node:fs'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect, Option } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'
import { copyTodomvcSrc } from './copy-examples.ts'
import {
  command as deployExamplesCommand,
  ensureExampleExists,
  readExampleSlugs,
  runExampleTests,
} from './deploy-examples.ts'

const cwd =
  process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
const examplesDir = `${cwd}/examples`

const exampleChoices = (() => {
  /**
   * The Effect CLI collects option metadata eagerly to power shell completions. We peek at the
   * filesystem synchronously here while the actual command logic still validates everything via the
   * Effect-powered helpers to stay robust at runtime.
   */
  try {
    return fs
      .readdirSync(examplesDir)
      .filter((entry) => {
        try {
          return fs.statSync(`${examplesDir}/${entry}`).isDirectory()
        } catch {
          return false
        }
      })
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
})()

const examplesTestCommand = Cli.Command.make(
  'test',
  {
    example: Cli.Options.choice('example', exampleChoices).pipe(Cli.Options.optional),
  },
  Effect.fn(function* ({ example }) {
    // Reuse the deploy helpers so local workflows and CI keep the same validation rules.
    const availableExamples = yield* readExampleSlugs()
    const targets = Option.isSome(example)
      ? [yield* ensureExampleExists(example.value, availableExamples)]
      : availableExamples

    if (targets.length === 0) {
      yield* Effect.logWarning('No examples found in the examples directory')
      return
    }

    yield* runExampleTests(targets)
  }),
)

const examplesRunCommand = Cli.Command.make(
  'run',
  {
    example: Cli.Args.choice(
      exampleChoices.map((example) => [example, example]),
      { name: 'example' },
    ),
  },
  Effect.fn(function* ({ example }) {
    const availableExamples = yield* readExampleSlugs()
    const selected = yield* ensureExampleExists(example, availableExamples)
    // Use the per-example working directory so dotenv / env loading behaves as if users ran pnpm dev manually.
    yield* cmd(`pnpm dev`, { cwd: `${cwd}/examples/${selected}` })
  }),
)

export const examplesCommand = Cli.Command.make('examples').pipe(
  Cli.Command.withSubcommands([
    deployExamplesCommand,
    copyTodomvcSrc,
    examplesRunCommand,
    examplesTestCommand,
  ]),
)
