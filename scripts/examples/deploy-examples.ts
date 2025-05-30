/* eslint-disable unicorn/no-process-exit */
import fs from 'node:fs'
import process from 'node:process'

import { Effect, Logger, LogLevel, Option, Schema } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'

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
    yield* cmd(['pnpm', 'build'], { cwd })

    // TODO replace pnpm dlx with bunx again once fixed (https://share.cleanshot.com/CKSg1dX9)
    const deployCommand = cmdText(
      [
        'pnpm',
        '--package=netlify-cli',
        'dlx',
        'netlify',
        // 'bunx',
        // 'netlify-cli',
        'deploy',
        '--no-build',
        '--json',
        `--dir=${EXAMPLES_SRC_DIR}/${example}/dist`,
        `--site=example-${example}`,
        // Either use `--prod` or `--alias`
        prod ? '--prod' : Option.isSome(alias) ? `--alias=${alias.value}` : undefined,
      ],
      {
        cwd,
        env: { CI: '1' }, // Prevent netlify from using TTY
      },
    )

    const result = yield* deployCommand.pipe(
      Effect.tap((result) => Effect.logDebug(`Deploy result for ${example}: ${result}`)),
      Effect.andThen(Schema.decode(Schema.parseJson(netlifyDeployResultSchema))),
      Effect.retry({ times: 2 }),
      Effect.tapErrorCause((cause) => Effect.logError(`Error deploying ${example}. Cause:`, cause)),
    )

    console.log(`Deployed ${example} to ${result.deploy_url}`)

    return result
  }).pipe(
    Effect.withSpan(`deploy-example-${example}`, { attributes: { example, prod, alias } }),
    Effect.tapErrorCause((cause) => Effect.logError(`Error deploying ${example}. Cause:`, cause)),
  )

export const command = Cli.Command.make(
  'deploy',
  {
    exampleFilter: Cli.Options.text('example-filter').pipe(Cli.Options.withAlias('e'), Cli.Options.optional),
    prod: Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false)),
    alias: Cli.Options.text('alias').pipe(Cli.Options.optional),
  },
  Effect.fn(function* ({ alias, exampleFilter, prod }) {
    const excludeDirs = new Set([
      'expo-linearlite',
      'expo-todomvc-sync-cf',
      'node-effect-cli',
      'node-todomvc-sync-cf',
      'todomvc-sync-electric',
    ])
    const examplesToDeploy = fs
      .readdirSync(EXAMPLES_SRC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !excludeDirs.has(entry.name))
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

    const results = yield* Effect.forEach(
      filteredExamplesToDeploy,
      (example) => buildAndDeployExample({ example, prod, alias }),
      { concurrency: 4 },
    )

    console.log(`Deployed ${results.length} examples:`)
    for (const result of results) {
      console.log(`  ${result.site_name}: ${result.deploy_url}`)
    }
  }),
)

if (import.meta.main) {
  const cli = Cli.Command.run(command, {
    name: 'Deploy Examples',
    version: '0.0.0',
  })

  cli(process.argv).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(PlatformNode.NodeContext.layer),
    PlatformNode.NodeRuntime.runMain,
  )
}
