import process from 'node:process'

import { Effect, FileSystem, Logger, LogLevel, Option, Schema } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'

import {
  buildCloudflareWorker,
  type CloudflareEnvironmentKind,
  deployCloudflareWorker,
  getCloudflareExample,
  resolveCloudflareAccountId,
  resolveCloudflareApiToken,
  resolveEnvironmentName,
  resolveWorkerName,
  resolveWorkersSubdomain,
} from '../../shared/cloudflare.ts'
import { cloudflareExamples } from '../../shared/cloudflare-manifest.ts'
import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../../shared/misc.ts'

/**
 * Deploys the example gallery to Cloudflare Workers. Handles prod/dev/preview behaviour while
 * leaving DNS updates to a dedicated subcommand.
 */

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

const examplesDir = `${workspaceRoot}/examples`

// Accept only the fields we care about (scripts) while tolerating extra metadata from Vite or toolchains.
const ExamplePackageJsonSchema = Schema.Struct(
  {
    scripts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
)

const parseExamplePackageJson = Schema.decodeUnknown(Schema.parseJson(ExamplePackageJsonSchema))

export const readExampleSlugs = Effect.fn('deploy-examples/readExampleSlugs')(function* () {
  /**
   * Cloudflare deploys operate on example directories; walk the examples root once so every caller
   * shares a consistent snapshot of what is available on disk.
   */
  const fs = yield* FileSystem.FileSystem
  const entries = yield* fs.readDirectory(examplesDir)
  const directories: string[] = []

  for (const entry of entries) {
    const info = yield* fs.stat(`${examplesDir}/${entry}`).pipe(
      Effect.map((stat) => stat.type === 'Directory'),
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (info) {
      directories.push(entry)
    }
  }

  directories.sort((a, b) => a.localeCompare(b))
  return directories
})

export const ensureExampleExists = (example: string, available: readonly string[]) =>
  available.includes(example)
    ? Effect.succeed(example)
    : Effect.fail(
        new Error(
          `Unknown example "${example}". Available examples: ${available.length > 0 ? available.join(', ') : 'none'}`,
        ),
      )

export const runExampleTests = (examples: ReadonlyArray<string>, options: { skipMissing?: boolean } = {}) =>
  Effect.gen(function* () {
    /**
     * Lightweight preflight that mirrors the `mono examples test` command so CI and deploys share
     * the same behaviour. We deliberately run sequentially to avoid overwhelming the runner when
     * Vite spins up multiple dev servers.
     */
    if (examples.length === 0) {
      yield* Effect.logDebug('No examples provided for testing')
      return
    }

    const skipMissing = options.skipMissing ?? true
    const fs = yield* FileSystem.FileSystem

    for (const example of examples) {
      const packageJsonPath = `${examplesDir}/${example}/package.json`
      const hasPackageJson = yield* fs.exists(packageJsonPath)

      if (!hasPackageJson) {
        if (skipMissing) {
          yield* Effect.logWarning(`Skipping ${example}: package.json not found`)
          continue
        }
        return yield* Effect.fail(new Error(`Cannot run tests for ${example}: package.json not found`))
      }

      const packageJsonContent = yield* fs.readFileString(packageJsonPath)
      const decoded = yield* parseExamplePackageJson(packageJsonContent).pipe(Effect.either)

      if (decoded._tag === 'Left') {
        if (skipMissing) {
          yield* Effect.logWarning(`Skipping ${example}: unable to decode package.json`)
          continue
        }
        return yield* Effect.fail(new Error(`Cannot run tests for ${example}: invalid package.json`))
      }

      const packageJson = decoded.right
      if (typeof packageJson.scripts?.test !== 'string') {
        if (skipMissing) {
          yield* Effect.logWarning(`Skipping ${example}: no test script defined`)
          continue
        }
        return yield* Effect.fail(new Error(`Cannot run tests for ${example}: no test script defined`))
      }

      yield* Effect.log(`Running tests for ${example}`)
      yield* cmd('pnpm test', {
        cwd: `${examplesDir}/${example}`,
        env: { CI: '1' },
      })
    }
  })

const DEV_BRANCH_NAME = 'dev'

interface DeploymentSummary {
  example: string
  workerName: string
  workerHost: string
  env: 'prod' | 'dev' | 'preview'
  domains: string[]
  previewUrl?: string
}

export const formatDeploymentSummaryMarkdown = (summaries: ReadonlyArray<DeploymentSummary>) => {
  const rows = summaries.map((summary) => [
    summary.example,
    summary.workerHost,
    summary.env,
    summary.domains.length > 0 ? summary.domains.join(', ') : '—',
    summary.previewUrl ?? '—',
  ])

  return formatMarkdownTable({
    title: 'Deployed examples',
    headers: ['Example', 'Worker', 'Target', 'Domains', 'Preview'],
    rows,
    emptyMessage: '_No examples were deployed in this run._',
  })
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
 * Decide whether a deploy should target the prod worker, dev worker, or the shared preview
 * environment.
 */
const determineDeploymentKind = ({
  prod,
  branchName,
}: {
  prod: boolean
  branchName: string
}): CloudflareEnvironmentKind => {
  const normalizedBranch = branchName.toLowerCase()

  if (prod || normalizedBranch === 'main') {
    return 'prod'
  }

  if (normalizedBranch === DEV_BRANCH_NAME) {
    return 'dev'
  }

  return 'preview'
}

const formatDomain = (domain: { domain: string; name: string }) =>
  domain.name === '@' ? domain.domain : `${domain.name}.${domain.domain}`

const deploymentKindLabel = (kind: CloudflareEnvironmentKind) => kind

/**
 * Build + deploy a single example, returning a summary that can be rendered in the CLI table.
 */
const deployExample = ({
  exampleSlug,
  prod,
  branchName,
  workersSubdomain,
}: {
  exampleSlug: string
  prod: boolean
  branchName: string
  workersSubdomain: string
}) =>
  Effect.gen(function* () {
    const manifest = yield* getCloudflareExample(exampleSlug)
    const deploymentKind = determineDeploymentKind({ prod, branchName })
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
      env: deploymentKind,
      domains: scopedDomains.map(formatDomain),
      ...(deploymentKind === 'preview' ? ({ previewUrl: `https://${workerHost}` } as const) : {}),
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
  },
  Effect.fn(function* ({ exampleFilter, prod }) {
    // Ensure credentials are present before kicking off parallel builds; wrangler fails with
    // an opaque message otherwise.
    yield* resolveCloudflareAccountId
    yield* resolveCloudflareApiToken

    const { branchName } = yield* getBranchInfo
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
          prod,
          branchName,
          workersSubdomain,
        }),
      { concurrency: 3 },
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

    // Also surface the deployment results in the GitHub run summary when available.
    yield* appendGithubSummaryMarkdown({
      markdown: formatDeploymentSummaryMarkdown(results),
      context: 'example deployment',
    })
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
