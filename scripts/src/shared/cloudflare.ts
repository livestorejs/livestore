import process from 'node:process'

import { Effect, Option, Schema } from '@livestore/utils/effect'
import { cmd, cmdText } from '@livestore/utils-dev/node'

import { type CloudflareDomain, type CloudflareExample, cloudflareExamplesBySlug } from './cloudflare-manifest.ts'

/**
 * Tagged error used across Cloudflare deployment utilities so callers can
 * pattern match on the error reason (auth/config/dns/unknown).
 */
export class CloudflareError extends Schema.TaggedError<CloudflareError>()('CloudflareError', {
  reason: Schema.Literal('auth', 'config', 'dns', 'unknown'),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const resolveCloudflareAccountId: Effect.Effect<string, CloudflareError> = Effect.gen(function* () {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID

  if (accountId === undefined || accountId.trim() === '') {
    /**
     * Keep the error channel structured so callers can surface a helpful message
     * instead of dealing with a generic string/throw.
     */
    return yield* new CloudflareError({
      reason: 'auth',
      message:
        'CLOUDFLARE_ACCOUNT_ID is not set. Export it in .envrc.local or set CLOUDFLARE_ENV specific .env files before deploying.',
    })
  }

  return accountId.trim()
})

export const resolveCloudflareApiToken: Effect.Effect<string, CloudflareError> = Effect.gen(function* () {
  const token = process.env.CLOUDFLARE_API_TOKEN

  if (token === undefined || token.trim() === '') {
    return yield* new CloudflareError({
      reason: 'auth',
      message: 'CLOUDFLARE_API_TOKEN is not set. Login with `bunx wrangler login` or export a token in .envrc.local.',
    })
  }

  return token.trim()
})

const CLOUDFLARE_WORKERS_SUBDOMAIN_FALLBACK = 'livestore'

export const resolveWorkersSubdomain = Effect.gen(function* () {
  const subdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN ?? CLOUDFLARE_WORKERS_SUBDOMAIN_FALLBACK

  if (subdomain === undefined || subdomain.trim() === '') {
    /**
     * The workers subdomain defaults to the livestore global value but we still
     * fail fast if the result is empty so deploy commands do not silently
     * generate broken hostnames.
     */
    return yield* new CloudflareError({
      reason: 'config',
      message: 'CLOUDFLARE_WORKERS_SUBDOMAIN is not configured.',
    })
  }

  return subdomain.trim()
})

export const getCloudflareExample = (slug: string): Effect.Effect<CloudflareExample, CloudflareError> =>
  Effect.sync(() => cloudflareExamplesBySlug.get(slug)).pipe(
    Effect.filterOrFail(
      (value): value is CloudflareExample => value !== undefined,
      () =>
        new CloudflareError({
          reason: 'config',
          message: `Unknown Cloudflare example slug: ${slug}`,
        }),
    ),
  )

export type CloudflareEnvironmentKind = 'prod' | 'dev' | { _tag: 'preview'; alias: string }

export const resolveEnvironmentName = ({
  example,
  kind,
}: {
  example: CloudflareExample
  kind: CloudflareEnvironmentKind
}) => {
  /**
   * Vite flattens env-specific config at build time based on CLOUDFLARE_ENV,
   * so we only need to signal whether we want the prod or dev build when naming
   * the worker. Preview deploys reuse the prod config but receive a unique alias.
   */
  if (kind === 'prod') {
    return example.aliases.prod
  }

  if (kind === 'dev') {
    return example.aliases.dev
  }

  return example.aliases.prod
}

export const createPreviewAlias = ({
  branch,
  shortSha,
  explicitAlias,
}: {
  branch: string
  shortSha: string
  explicitAlias: Option.Option<string>
}) => {
  /**
   * Preview workers must respect the DNS label limit of 63 chars. We reuse the
   * Netlify-style `branch-<branch>-<sha>` format unless the caller supplied a
   * specific alias via CLI.
   */
  const sanitizedBranch = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  if (Option.isSome(explicitAlias)) {
    return sanitizeWorkerSuffix(explicitAlias.value)
  }

  return sanitizeWorkerSuffix(`branch-${sanitizedBranch}-${shortSha}`)
}

const sanitizeWorkerSuffix = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)

export const resolveWorkerName = ({
  example,
  kind,
}: {
  example: CloudflareExample
  kind: CloudflareEnvironmentKind
}) => {
  /**
   * Keep worker names deterministic so the DNS command can infer the workers.dev
   * host without needing API lookups. Preview workers piggy-back on the prod
  worker name with a sanitized suffix.
   */
  if (kind === 'prod') {
    return example.workerName
  }

  if (kind === 'dev') {
    return sanitizeWorkerSuffix(`${example.workerName}-dev`)
  }

  return sanitizeWorkerSuffix(`${example.workerName}-${kind.alias}`)
}

export const buildCloudflareWorker = ({
  example,
  kind,
}: {
  example: CloudflareExample
  kind: CloudflareEnvironmentKind
}) => {
  const envName = resolveEnvironmentName({ example, kind })

  /**
   * We rely on Vite's Cloudflare plugin to emit the environment-specific
   * wrangler.json when CLOUDFLARE_ENV is set. The rest of the pipeline works
   * off the build output.
   */
  return cmd(['pnpm', 'build'], {
    cwd: example.repoRelativePath,
    env: {
      ...process.env,
      CLOUDFLARE_ENV: envName,
    },
  })
}

export const deployCloudflareWorker = ({
  example,
  kind,
  dryRun = false,
}: {
  example: CloudflareExample
  kind: CloudflareEnvironmentKind
  dryRun?: boolean
}) => {
  const envName = resolveEnvironmentName({ example, kind })
  const workerName = resolveWorkerName({ example, kind })

  /**
   * Use the generated wrangler.json under the build directory so we do not have
   * to maintain separate deploy config files per environment.
   */
  return cmd(
    [
      'bunx',
      'wrangler',
      'deploy',
      dryRun ? '--dry-run' : undefined,
      '--config',
      `dist/${example.buildOutputDir}/wrangler.json`,
      '--name',
      workerName,
    ],
    {
      cwd: example.repoRelativePath,
      env: {
        ...process.env,
        CLOUDFLARE_ENV: envName,
      },
    },
  ).pipe(
    Effect.mapError(
      (cause) =>
        new CloudflareError({
          reason: 'unknown',
          message: `Failed to deploy Worker for ${example.slug} (${envName})`,
          cause,
        }),
    ),
    Effect.withSpan(`deploy-worker-${example.slug}`, {
      attributes: {
        slug: example.slug,
        env: envName,
        dry_run: dryRun,
        worker_name: workerName,
      },
    }),
  )
}

type VercelDnsRecord = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly value: string
}

const parseVercelDnsRecords = (output: string): readonly VercelDnsRecord[] =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('rec_'))
    .flatMap((line) => {
      const [id, name, type, ...rest] = line.split(/\s+/)
      if (id === undefined || name === undefined || type === undefined || rest.length === 0) {
        return []
      }

      return [
        {
          id,
          name,
          type,
          value: rest.join(' '),
        } satisfies VercelDnsRecord,
      ]
    })

const normalizeDnsValue = (value: string) => value.replace(/\.$/, '')

export const ensureVercelCnameRecord = ({ domain, name, target }: CloudflareDomain & { target: string }) =>
  Effect.gen(function* () {
    const dnsList = yield* cmdText(['bunx', 'vercel', 'dns', 'ls', domain]).pipe(
      Effect.mapError(
        (cause) =>
          new CloudflareError({
            reason: 'dns',
            message: `Failed to list DNS records for ${domain}`,
            cause,
          }),
      ),
    )

    const records = parseVercelDnsRecords(dnsList)
    const targetValue = normalizeDnsValue(target)

    const matchingRecords = records.filter((record) => record.name === name && record.type.toUpperCase() === 'CNAME')

    const staleRecords = matchingRecords.filter((record) => normalizeDnsValue(record.value) !== targetValue)

    for (const staleRecord of staleRecords) {
      yield* cmd(`printf 'y\\n' | bunx vercel dns rm ${staleRecord.id}`, {
        shell: true,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CloudflareError({
              reason: 'dns',
              message: `Failed to remove stale DNS record ${staleRecord.id} (${staleRecord.name}).`,
              cause,
            }),
        ),
      )
    }

    const existingTargetRecords = matchingRecords.filter(
      (record) =>
        normalizeDnsValue(record.value) === targetValue && !staleRecords.some((stale) => stale.id === record.id),
    )

    if (existingTargetRecords.length === 0) {
      yield* cmd(['bunx', 'vercel', 'dns', 'add', domain, name, 'CNAME', target], {}).pipe(
        Effect.mapError(
          (cause) =>
            new CloudflareError({
              reason: 'dns',
              message: `Failed to add DNS record for ${name}.${domain}.`,
              cause,
            }),
        ),
      )
    }
  })
