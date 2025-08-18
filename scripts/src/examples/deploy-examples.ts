import fs from 'node:fs'
import process from 'node:process'

import { Effect, Logger, LogLevel, Option } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd } from '@livestore/utils-dev/node'

import { deployToNetlify } from '../shared/netlify.ts'

/**
 * This script is used to deploy prod-builds of all examples to Netlify.
 * It assumes existing Netlify sites with names `example-<example-name>`.
 */

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

const EXAMPLES_SRC_DIR = `${workspaceRoot}/examples`

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

    const result = yield* deployToNetlify({
      site: `example-${example}`,
      dir: `${EXAMPLES_SRC_DIR}/${example}/dist`,
      target: Option.isSome(alias) ? { _tag: 'alias', alias: alias.value } : { _tag: 'prod' },
      cwd,
    }).pipe(
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
  Effect.fn(
    function* ({ alias, exampleFilter, prod }) {
      const excludeDirs = new Set([
        'expo-linearlite',
        'expo-todomvc-sync-cf',
        'node-effect-cli',
        'node-todomvc-sync-cf',
        'web-todomvc-sync-electric',
        'cloudflare-todomvc',
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
    },
    Effect.catchIf(
      (e) => e._tag === 'NetlifyError' && e.reason === 'auth',
      () => Effect.logWarning('::warning Not logged in to Netlify'),
    ),
  ),
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
