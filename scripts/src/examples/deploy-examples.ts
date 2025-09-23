import fs from 'node:fs'
import process from 'node:process'

import { Effect, Logger, LogLevel, Option } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'

import { deployToNetlify } from '../shared/netlify.ts'

type NetlifyTarget = Parameters<typeof deployToNetlify>[0]['target']

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

const DEV_BRANCH_NAME = 'dev'

/**
 * Thin wrapper around the Netlify deploy target union so we can annotate the site that should
 * receive a deploy and whether we intend to hit prod or a named alias.
 */
interface DeploymentConfig {
  site: string
  target: NetlifyTarget
}

interface DeploymentSummary {
  example: string
  site: string
  siteName: string
  deployUrl: string
  target: NetlifyTarget['_tag']
  alias?: string
}

/**
 * Resolve the current git branch and short SHA from CI-friendly environment variables or git.
 * We prefer `GITHUB_BRANCH_NAME` when present so GitHub Actions can inject the branch during checkout.
 */
const getBranchInfo = Effect.gen(function* () {
  const branchFromEnv = process.env.GITHUB_BRANCH_NAME ?? process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF

  let branchName =
    branchFromEnv && branchFromEnv.trim().length > 0
      ? branchFromEnv.trim()
      : (yield* cmdText('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot })).trim()

  if (branchName === '' || branchName === 'HEAD') {
    const refFromEnv = process.env.GITHUB_REF
    if (refFromEnv?.startsWith('refs/')) {
      const [, , ...rest] = refFromEnv.split('/')
      branchName = rest.join('/')
    }
  }

  const shortSha = (yield* cmdText('git rev-parse --short HEAD', { cwd: workspaceRoot })).trim()

  return { branchName, shortSha }
})

const sanitizeAlias = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Decide which Netlify site and target we should deploy to for a given example based on branch,
 * CLI flags (`--prod` and `--alias`), and a fall-back alias derived from the branch + commit.
 */
const resolveDeployment = ({
  example,
  alias,
  prod,
  branchName,
  shortSha,
}: {
  example: string
  alias: Option.Option<string>
  prod: boolean
  branchName: string
  shortSha: string
}): DeploymentConfig => {
  const exampleSite = `example-${example}`
  const devSite = `${exampleSite}-dev`

  const normalizedBranch = branchName.toLowerCase()
  const site = prod || normalizedBranch === 'main' ? exampleSite : devSite

  const aliasValue = Option.isSome(alias)
    ? sanitizeAlias(alias.value)
    : sanitizeAlias(`branch-${normalizedBranch}-${shortSha}`)

  const defaultAlias = sanitizeAlias(`snapshot-${shortSha}`)
  const aliasCandidate = aliasValue.length > 0 ? aliasValue : defaultAlias
  const safeAlias =
    aliasCandidate.length > 0
      ? aliasCandidate.slice(0, 63)
      : (defaultAlias.length > 0 ? defaultAlias : `snapshot-${shortSha}`).slice(0, 63)

  if (Option.isSome(alias)) {
    return { site, target: { _tag: 'alias', alias: safeAlias } }
  }

  if (prod || normalizedBranch === 'main' || normalizedBranch === DEV_BRANCH_NAME) {
    return { site, target: { _tag: 'prod' } }
  }

  return { site, target: { _tag: 'alias', alias: safeAlias } }
}

const buildAndDeployExample = ({ example, deployment }: { example: string; deployment: DeploymentConfig }) =>
  Effect.gen(function* () {
    const cwd = `${EXAMPLES_SRC_DIR}/${example}`
    yield* cmd(['pnpm', 'build'], { cwd })

    const result = yield* deployToNetlify({
      site: deployment.site,
      dir: `${EXAMPLES_SRC_DIR}/${example}/dist`,
      target: deployment.target,
      cwd,
    }).pipe(
      Effect.retry({ times: 2 }),
      Effect.tapErrorCause((cause) => Effect.logError(`Error deploying ${example}. Cause:`, cause)),
    )

    console.log(`Deployed ${example} to ${result.deploy_url}`)

    const summary: DeploymentSummary = {
      example,
      site: deployment.site,
      siteName: result.site_name,
      deployUrl: result.deploy_url,
      target: deployment.target._tag,
      alias: deployment.target._tag === 'alias' ? deployment.target.alias : '<none>',
    }

    return summary
  }).pipe(
    Effect.withSpan(`deploy-example-${example}`, {
      attributes: {
        example,
        site: deployment.site,
        target: deployment.target._tag,
        alias: deployment.target._tag === 'alias' ? deployment.target.alias : undefined,
      },
    }),
    Effect.tapErrorCause((cause) => Effect.logError(`Error deploying ${example}. Cause:`, cause)),
    Effect.annotateLogs({ example }),
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
      const { branchName, shortSha } = yield* getBranchInfo

      console.log(`Deploy branch: ${branchName}`)

      const excludeDirs = new Set([
        'expo-linearlite',
        'expo-todomvc-sync-cf',
        'node-effect-cli',
        'node-todomvc-sync-cf',
        'web-todomvc-sync-electric',
        'web-todomvc-sync-s2',
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
        (example) =>
          buildAndDeployExample({
            example,
            deployment: resolveDeployment({ example, alias, prod, branchName, shortSha }),
          }),
        { concurrency: 4 },
      )

      console.log(`Deployed ${results.length} examples`)

      const tableRows = results.map((result) => ({
        Example: result.example,
        Site: result.site,
        'Site Name': result.siteName,
        Target: result.target === 'alias' ? `alias:${result.alias ?? 'n/a'}` : result.target,
        'Deploy URL': result.deployUrl,
      }))

      console.log('\nDeployment summary:')
      console.table(tableRows)
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
