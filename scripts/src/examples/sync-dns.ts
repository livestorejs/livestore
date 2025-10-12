import { Effect, Logger, LogLevel, Option } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'

import {
  ensureVercelCnameRecord,
  getCloudflareExample,
  resolveWorkerName,
  resolveWorkersSubdomain,
} from '../shared/cloudflare.ts'
import { cloudflareExamples } from '../shared/cloudflare-manifest.ts'

type TargetEnv = 'prod' | 'dev'

const formatDomain = (domain: { domain: string; name: string }) =>
  domain.name === '@' ? domain.domain : `${domain.name}.${domain.domain}`

/**
 * Updates the Vercel-managed DNS records for a single example/environment pair so that the
 * relevant `*.livestore.dev` host points at the chosen workers.dev service. This stays separate
 * from the deploy step to avoid requiring Vercel credentials in CI.
 */
const syncDnsForExample = ({
  exampleSlug,
  env,
  workersSubdomain,
}: {
  exampleSlug: string
  env: TargetEnv
  workersSubdomain: string
}) =>
  Effect.gen(function* () {
    const manifest = yield* getCloudflareExample(exampleSlug)
    const scopedDomains = manifest.domains.filter((domain) => domain.scope === env)

    if (scopedDomains.length === 0) {
      yield* Effect.log(`No ${env} domains configured for ${exampleSlug}`)
      return {
        example: exampleSlug,
        env,
        workerHost: 'n/a',
        domains: [] as string[],
      }
    }

    const workerName = resolveWorkerName({ example: manifest, kind: env })
    const workerHost = `${workerName}.${workersSubdomain}.workers.dev`

    for (const domain of scopedDomains) {
      const fqdn = formatDomain(domain)
      yield* Effect.log(`Syncing DNS ${fqdn} → ${workerHost}`)
      yield* ensureVercelCnameRecord({ ...domain, target: workerHost }).pipe(
        Effect.tapError((error) => Effect.logError(`DNS update failed for ${fqdn}`, error)),
      )
    }

    return {
      example: exampleSlug,
      env,
      workerHost,
      domains: scopedDomains.map(formatDomain),
    }
  })

export const syncDnsCommand = Cli.Command.make(
  'dns',
  {
    exampleFilter: Cli.Options.text('example-filter').pipe(Cli.Options.withAlias('e'), Cli.Options.optional),
    env: Cli.Options.text('env').pipe(
      Cli.Options.withDescription('Target environment (prod or dev)'),
      Cli.Options.withDefault('prod'),
    ),
  },
  /**
   * CLI entrypoint that mirrors the example deploy command and allows operators to target a
   * subset of examples/environments while keeping the workflow explicit.
   */
  Effect.fn(function* ({ exampleFilter, env }) {
    if (env !== 'prod' && env !== 'dev') {
      yield* Effect.logError(`Unsupported env '${env}'. Use 'prod' or 'dev'.`)
      return
    }

    const filteredExamples = cloudflareExamples.filter((example) =>
      Option.isSome(exampleFilter) ? example.slug.includes(exampleFilter.value) : true,
    )

    if (filteredExamples.length === 0) {
      const available = cloudflareExamples.map((example) => example.slug).join(', ')
      yield* Effect.logError(
        Option.isSome(exampleFilter)
          ? `No examples found matching filter: ${exampleFilter.value}. Available examples: ${available}`
          : 'No examples configured for DNS syncing.',
      )
      return
    }

    const workersSubdomain = yield* resolveWorkersSubdomain
    yield* Effect.log(`Updating ${env} DNS records for: ${filteredExamples.map((example) => example.slug).join(', ')}`)

    const results = yield* Effect.forEach(
      filteredExamples,
      (example) => syncDnsForExample({ exampleSlug: example.slug, env, workersSubdomain }),
      { concurrency: 3 },
    )

    const tableRows = results.map((result) => ({
      Example: result.example,
      Env: result.env,
      Worker: result.workerHost,
      Domains: result.domains.length > 0 ? result.domains.join(', ') : '—',
    }))

    console.log('\nDNS summary:')
    console.table(tableRows)
  }),
)

if (import.meta.main) {
  const cli = Cli.Command.run(syncDnsCommand, {
    name: 'Sync Example DNS',
    version: '0.0.0',
  })

  cli(process.argv).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(PlatformNode.NodeContext.layer),
    PlatformNode.NodeRuntime.runMain,
  )
}
