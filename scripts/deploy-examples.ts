import fs from 'node:fs'
import process from 'node:process'

import { Command, Options } from '@effect/cli'
import { BunContext, BunRuntime } from '@effect/platform-bun'
import { $ } from 'bun'
import { Effect, Option, Schema } from 'effect'

const cwd = process.cwd()

// Directories
const EXAMPLES_MONOREPO_DIR = `${cwd}/examples-monorepo`

const netlifyDeployResultSchema = Schema.Struct({
  site_id: Schema.String,
  site_name: Schema.String,
  deploy_id: Schema.String,
  deploy_url: Schema.String,
  logs: Schema.String,
})

const buildAndDeployExample = ({ example, prod }: { example: string; prod: boolean }) =>
  Effect.gen(function* () {
    $.cwd(EXAMPLES_MONOREPO_DIR)
    yield* Effect.promise(() => $`pnpm build`)
    const resultJson = yield* Effect.promise(() =>
      $`bunx netlify deploy --dir=${EXAMPLES_MONOREPO_DIR}/${example}/dist --site=example-${example} --json ${prod ? '--prod' : ''}`.json(),
    )

    const result = yield* Schema.decode(netlifyDeployResultSchema)(resultJson).pipe(
      Effect.tapError(Effect.logError),
      Effect.tapError(() => Effect.logError(`Error deploying ${example}. Result:`, resultJson)),
    )

    console.log(`Deployed ${example} to ${result.deploy_url}`)
  })

const deploy = ({ exampleFilter, prod }: { exampleFilter: Option.Option<string>; prod: boolean }) =>
  Effect.gen(function* () {
    const examplesToDeploy = fs
      .readdirSync(EXAMPLES_MONOREPO_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.includes('expo') === false)
      .map((entry) => entry.name)

    const filteredExamplesToDeploy = examplesToDeploy.filter((example) =>
      Option.isSome(exampleFilter) ? example.includes(exampleFilter.value) : true,
    )

    if (filteredExamplesToDeploy.length === 0 && Option.isSome(exampleFilter)) {
      console.error(
        `No examples found matching filter: ${exampleFilter.value}. Available examples: ${examplesToDeploy.join(', ')}`,
      )
      return
    } else {
      console.log(`Deploying${prod ? '  (to prod)' : ''}: ${filteredExamplesToDeploy.join(', ')}`)
    }

    yield* Effect.forEach(filteredExamplesToDeploy, (example) => buildAndDeployExample({ example, prod }), {
      concurrency: 4,
    })
  })

const exampleFilterOption = Options.text('example-filter').pipe(Options.withAlias('e'), Options.optional)
const prodOption = Options.boolean('prod').pipe(Options.withDefault(false))

const command = Command.make(
  'deploy',
  { exampleFilter: exampleFilterOption, prod: prodOption },
  ({ exampleFilter, prod }) => deploy({ exampleFilter, prod }),
)

const cli = Command.run(command, {
  name: 'Prompt Examples',
  version: '0.0.1',
})

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
