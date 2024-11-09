/* eslint-disable unicorn/no-process-exit */
import fs from 'node:fs'
import process from 'node:process'

import { BunContext, BunRuntime } from '@effect/platform-bun'
import { Effect, Option, Schema } from 'effect'

import { BunShell, Cli } from './lib.js'

/**
 * This script is used to deploy prod-builds of all examples to Netlify.
 * It assumes existing Netlify sites with names `example-<example-name>`.
 */

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

const EXAMPLES_SRC_DIR = `${workspaceRoot}/examples/src`

const netlifyDeployResultSchema = Schema.Struct({
  site_id: Schema.String,
  site_name: Schema.String,
  deploy_id: Schema.String,
  deploy_url: Schema.String,
  logs: Schema.String,
})

const buildAndDeployExample = ({
  example,
  prod,
  alias,
}: {
  example: string
  prod: boolean
  alias: Option.Option<string>
}) =>
  Effect.gen(function* () {
    const cwd = `${EXAMPLES_SRC_DIR}/${example}`
    yield* BunShell.cmd('pnpm build', cwd)
    const prodFlag = prod ? '--prod' : ''
    const aliasFlag = Option.isSome(alias) ? `--alias=${alias.value}` : ''
    const deployCommand = `bunx netlify deploy --dir=${EXAMPLES_SRC_DIR}/${example}/dist --site=example-${example} ${prodFlag} ${aliasFlag}`
    // Gradually falling back for debugging purposes
    const resultJson = yield* BunShell.cmdJson(`${deployCommand} --json`, cwd).pipe(
      Effect.catchAllCause(() => BunShell.cmdText(`${deployCommand} --json`, cwd)),
      Effect.catchAllCause(() => BunShell.cmd(`${deployCommand}`, cwd)),
    )

    const result = yield* Schema.decode(netlifyDeployResultSchema)(resultJson).pipe(
      Effect.tapError(Effect.logError),
      Effect.tapError(() => Effect.logError(`Error deploying ${example}. Result:`, resultJson)),
    )

    console.log(`Deployed ${example} to ${result.deploy_url}`)
  }).pipe(Effect.tapErrorCause((cause) => Effect.logError(`Error deploying ${example}. Cause:`, cause)))

const deploy = ({
  exampleFilter,
  prod,
  alias,
}: {
  exampleFilter: Option.Option<string>
  prod: boolean
  alias: Option.Option<string>
}) =>
  Effect.gen(function* () {
    const examplesToDeploy = fs
      .readdirSync(EXAMPLES_SRC_DIR, { withFileTypes: true })
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
      console.log(`Deploying${prod ? ' (to prod)' : ''}: ${filteredExamplesToDeploy.join(', ')}`)
    }

    yield* Effect.forEach(filteredExamplesToDeploy, (example) => buildAndDeployExample({ example, prod, alias }), {
      concurrency: 4,
    })
  })

const exampleFilterOption = Cli.Options.text('example-filter').pipe(Cli.Options.withAlias('e'), Cli.Options.optional)
const prodOption = Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false))
const aliasOption = Cli.Options.text('alias').pipe(Cli.Options.optional)

const command = Cli.Command.make(
  'deploy',
  { exampleFilter: exampleFilterOption, prod: prodOption, alias: aliasOption },
  ({ exampleFilter, prod, alias }) => deploy({ exampleFilter, prod, alias }),
)

const cli = Cli.Command.run(command, {
  name: 'Prompt Examples',
  version: '0.0.1',
})

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
