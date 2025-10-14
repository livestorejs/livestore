import process from 'node:process'

import { Effect, Logger, LogLevel, Option } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmdText } from '@livestore/utils-dev/node'

import {
  buildCloudflareWorker,
  type CloudflareEnvironmentKind,
  createPreviewAlias,
  deployCloudflareWorker,
  getCloudflareExample,
  resolveCloudflareAccountId,
  resolveCloudflareApiToken,
  resolveEnvironmentName,
  resolveWorkerName,
  resolveWorkersSubdomain,
} from '../shared/cloudflare.ts'
import { cloudflareExamples } from '../shared/cloudflare-manifest.ts'

/**
 * Deploys the example gallery to Cloudflare Workers. Handles prod/dev/preview behaviour while
 * leaving DNS updates to a dedicated subcommand.
 */

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

const DEV_BRANCH_NAME = 'dev'

interface DeploymentSummary {
  example: string
  workerName: string
  workerHost: string
  env: 'prod' | 'dev' | 'preview'
  domains: string[]
  alias?: string
  previewUrl?: string
}

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

/**
 * Decide whether a deploy should target the prod worker, dev worker, or an ephemeral preview
 * alias. Preview aliases are deterministic and safe for DNS labels.
 */
const determineDeploymentKind = ({
  aliasOption,
  prod,
  branchName,
  shortSha,
}: {
  aliasOption: Option.Option<string>
  prod: boolean
  branchName: string
  shortSha: string
}): CloudflareEnvironmentKind => {
  const normalizedBranch = branchName.toLowerCase()

  if (prod || normalizedBranch === 'main') {
    return 'prod'
  }

  if (normalizedBranch === DEV_BRANCH_NAME) {
    return 'dev'
  }

  const alias = createPreviewAlias({ branch: normalizedBranch, shortSha, explicitAlias: aliasOption })

  return { _tag: 'preview', alias }
}

const formatDomain = (domain: { domain: string; name: string }) =>
  domain.name === '@' ? domain.domain : `${domain.name}.${domain.domain}`

const deploymentKindLabel = (kind: CloudflareEnvironmentKind) =>
  kind === 'prod' ? 'prod' : kind === 'dev' ? 'dev' : `preview:${kind.alias}`

/**
 * Build + deploy a single example, returning a summary that can be rendered in the CLI table.
 */
const deployExample = ({
  exampleSlug,
  aliasOption,
  prod,
  branchName,
  shortSha,
  workersSubdomain,
}: {
  exampleSlug: string
  aliasOption: Option.Option<string>
  prod: boolean
  branchName: string
  shortSha: string
  workersSubdomain: string
}) =>
  Effect.gen(function* () {
    const manifest = yield* getCloudflareExample(exampleSlug)
    const deploymentKind = determineDeploymentKind({ aliasOption, prod, branchName, shortSha })
    const envName = resolveEnvironmentName({ example: manifest, kind: deploymentKind })
    const workerName = resolveWorkerName({ example: manifest, kind: deploymentKind })
    const workerHost = `${workerName}.${workersSubdomain}.workers.dev`

    yield* Effect.log(`Building ${exampleSlug} (${envName})`)
    yield* buildCloudflareWorker({ example: manifest, kind: deploymentKind })

    yield* Effect.log(`Deploying ${exampleSlug} as ${workerName}`)
    yield* deployCloudflareWorker({ example: manifest, kind: deploymentKind }).pipe(
      Effect.retry({ times: 2 }),
      Effect.tapErrorCause((cause) => Effect.logError(`Error deploying ${exampleSlug}. Cause:`, cause)),
    )

    yield* Effect.annotateCurrentSpan({ deployment_kind: deploymentKindLabel(deploymentKind) })

    const scopedDomains =
      deploymentKind === 'prod'
        ? manifest.domains.filter((domain) => domain.scope === 'prod')
        : deploymentKind === 'dev'
          ? manifest.domains.filter((domain) => domain.scope === 'dev')
          : []

    const summary: DeploymentSummary = {
      example: manifest.slug,
      workerName,
      workerHost,
      env: typeof deploymentKind === 'string' ? deploymentKind : 'preview',
      domains: scopedDomains.map(formatDomain),
      ...(typeof deploymentKind === 'string'
        ? {}
        : ({ alias: deploymentKind.alias, previewUrl: `https://${workerHost}` } as const)),
    }

    return summary
  }).pipe(
    Effect.withSpan(`deploy-example-${exampleSlug}`, {
      attributes: {
        example: exampleSlug,
      },
    }),
  )

export const command = Cli.Command.make(
  'deploy',
  {
    exampleFilter: Cli.Options.text('example-filter').pipe(Cli.Options.withAlias('e'), Cli.Options.optional),
    prod: Cli.Options.boolean('prod').pipe(Cli.Options.withDefault(false)),
    alias: Cli.Options.text('alias').pipe(Cli.Options.withAlias('a'), Cli.Options.optional),
  },
  Effect.fn(function* ({ exampleFilter, prod, alias }) {
    // Ensure credentials are present before kicking off parallel builds; wrangler fails with
    // an opaque message otherwise.
    yield* resolveCloudflareAccountId
    yield* resolveCloudflareApiToken

    const { branchName, shortSha } = yield* getBranchInfo
    console.log(`Deploy branch: ${branchName}`)

    const filteredExamples = cloudflareExamples.filter((example) =>
      Option.isSome(exampleFilter) ? example.slug.includes(exampleFilter.value) : true,
    )

    if (filteredExamples.length === 0) {
      const available = cloudflareExamples.map((example) => example.slug).join(', ')
      console.error(
        Option.isSome(exampleFilter)
          ? `No examples found matching filter: ${exampleFilter.value}. Available examples: ${available}`
          : 'No examples configured for Cloudflare deployment.',
      )
      return
    }

    const workersSubdomain = yield* resolveWorkersSubdomain
    console.log(
      `Deploying${prod ? ' (to prod)' : ''}: ${filteredExamples.map((example) => example.slug).join(', ')} using ${workersSubdomain}.workers.dev`,
    )

    const results = yield* Effect.forEach(
      filteredExamples,
      (example) =>
        deployExample({
          exampleSlug: example.slug,
          aliasOption: alias,
          prod,
          branchName,
          shortSha,
          workersSubdomain,
        }),
      { concurrency: 1 },
    )

    console.log(`Deployed ${results.length} examples`)

    const tableRows = results.map((result) => ({
      Example: result.example,
      Worker: result.workerHost,
      Target: result.env,
      Domains: result.domains.length > 0 ? result.domains.join(', ') : '—',
      Preview: result.previewUrl ?? '—',
    }))

    console.log('\nDeployment summary:')
    console.table(tableRows)
  }),
)

if (import.meta.main) {
  const cli = Cli.Command.run(command, {
    name: 'Deploy Examples',
    version: '0.0.0',
  })

  Effect.gen(function* () {
    return yield* cli(process.argv)
  }).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(PlatformNode.NodeContext.layer),
    PlatformNode.NodeRuntime.runMain,
  )
}
