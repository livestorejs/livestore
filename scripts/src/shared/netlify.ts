import { readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { Effect, HttpClient, HttpClientRequest, Schema } from '@livestore/utils/effect'
import { cmdText } from '@livestore/utils-dev/node'

export class NetlifyError extends Schema.TaggedError<NetlifyError>()('NetlifyError', {
  reason: Schema.Literal('auth', 'unknown'),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const NetlifyDeployResultSchema = Schema.Struct({
  site_id: Schema.String,
  site_name: Schema.String,
  deploy_id: Schema.String,
  deploy_url: Schema.String,
  logs: Schema.String,
})

const NetlifyCliUserSchema = Schema.Struct({
  auth: Schema.optional(
    Schema.Struct({
      token: Schema.String,
    }),
  ),
})

const NetlifyCliConfigSchema = Schema.Struct({
  users: Schema.optional(Schema.Record({ key: Schema.String, value: NetlifyCliUserSchema })),
})

const NetlifyPurgeRequestSchema = Schema.Struct({
  site_id: Schema.optional(Schema.String),
  site_slug: Schema.optional(Schema.String),
})

export type Target =
  | {
      _tag: 'prod'
    }
  | {
      _tag: 'alias'
      alias: string
    }
  | {
      _tag: 'draft'
    }

const NOT_LOGGED_IN_TO_NETLIFY_ERROR_MESSAGE = 'Not logged in.'

const NETLIFY_API_URL = 'https://api.netlify.com/api/v1/purge'

/**
 * Deploy docs using the Netlify CLI by uploading the prebuilt directory.
 *
 * Assumptions:
 * - Astro already built the site (mono docs build) into ./docs/dist
 * - We want Edge Functions registered/activated without triggering another app build
 */
export const deployToNetlify = ({
  site,
  target,
  cwd,
  filter,
  message,
  dir,
  debug,
}: {
  site: string
  target: Target
  cwd: string
  filter?: string
  message?: string
  /** Absolute or docs-relative path to the built output directory. */
  dir: string
  /** When true, passes --debug to Netlify CLI and increases logging. */
  debug?: boolean
}) =>
  Effect.gen(function* () {
    const netlifyStatus = yield* cmdText(['bunx', 'netlify-cli', 'status'], { cwd, stderr: 'pipe' })

    if (netlifyStatus.includes(NOT_LOGGED_IN_TO_NETLIFY_ERROR_MESSAGE)) {
      return yield* new NetlifyError({ message: 'Not logged in to Netlify', reason: 'auth' })
    }

    // Extra diagnostics for CI/local parity
    if (debug === true) {
      yield* Effect.logDebug(
        `[deploy-to-netlify] preflight | cwd=${cwd} dir=${dir} site=${site} filter=${filter ?? '—'}`,
      )
      yield* Effect.logDebug(
        `[deploy-to-netlify] preflight | NETLIFY_CONFIG=${join(cwd, 'netlify.toml')}`,
      )
    }

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
        debug === true ? '--debug' : undefined,
        `--dir=${dir}`,
        `--site=${site}`,
        filter ? `--filter=${filter}` : undefined,
        message ? `--message=${message}` : undefined,
        // Either use `--prod` or `--alias`
        target._tag === 'prod' ? '--prod' : target._tag === 'alias' ? `--alias=${target.alias}` : undefined,
      ],
      {
        cwd,
        env: {
          CI: '1', // Prevent netlify from using TTY
          // Force the CLI to read the docs-local Netlify config so Edge Functions
          // mapping is consistently applied in CI and locally.
          NETLIFY_CONFIG: join(cwd, 'netlify.toml'),
        },
      },
    )

    const result = yield* deployCommand.pipe(
      Effect.tap((result) => Effect.logDebug(`[deploy-to-netlify] Deploy result for ${site}: ${result}`)),
      Effect.andThen(Schema.decode(Schema.parseJson(NetlifyDeployResultSchema))),
      Effect.mapError(
        (error) =>
          new NetlifyError({ message: 'Failed to decode Netlify deploy result', reason: 'unknown', cause: error }),
      ),
    )

    return result
  })

const resolveNetlifyAuthToken = Effect.gen(function* () {
  const envToken = process.env.NETLIFY_AUTH_TOKEN
  if (envToken !== undefined && envToken !== '') {
    return envToken
  }

  const homeDirectory = os.homedir()
  if (!homeDirectory) {
    return yield* new NetlifyError({
      message: 'Unable to determine home directory for Netlify auth token lookup',
      reason: 'auth',
    })
  }

  const configCandidates = determineNetlifyConfigCandidates(homeDirectory)

  let configPath: string | undefined
  let configContent: string | undefined

  for (const candidate of configCandidates) {
    const readResult = yield* Effect.try({
      try: () => readFileSync(candidate, 'utf8'),
      catch: (error) => error as NodeJS.ErrnoException,
    }).pipe(Effect.either)

    if (readResult._tag === 'Right') {
      configContent = readResult.right
      configPath = candidate
      break
    }

    const readError = readResult.left
    if (isFileMissingError(readError)) {
      continue
    }

    return yield* new NetlifyError({
      message: `Failed to read Netlify CLI config at ${candidate}`,
      reason: 'auth',
      cause: readError,
    })
  }

  if (!configContent || !configPath) {
    return yield* new NetlifyError({
      message: `Netlify auth token not found. Checked: ${configCandidates.join(', ')}. Run 'bunx netlify-cli login' or set NETLIFY_AUTH_TOKEN.`,
      reason: 'auth',
    })
  }

  const config = yield* Schema.decode(Schema.parseJson(NetlifyCliConfigSchema))(configContent).pipe(
    Effect.mapError(
      (error) =>
        new NetlifyError({
          message: `Failed to parse Netlify CLI config at ${configPath}`,
          reason: 'auth',
          cause: error,
        }),
    ),
  )

  const resolvedToken = config.users
    ? Object.values(config.users)
        .map((user) => user.auth?.token)
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
    : undefined

  if (!resolvedToken) {
    return yield* new NetlifyError({
      message: `Netlify auth token not found in ${configPath}. Run 'bunx netlify-cli login' or set NETLIFY_AUTH_TOKEN.`,
      reason: 'auth',
    })
  }

  return resolvedToken
})

export const purgeNetlifyCdn = ({ siteId, siteSlug }: { siteId?: string; siteSlug?: string }) =>
  Effect.gen(function* () {
    if (!siteId && !siteSlug) {
      return yield* new NetlifyError({
        message: 'A site identifier is required to purge the Netlify CDN cache',
        reason: 'unknown',
      })
    }

    const token = yield* resolveNetlifyAuthToken
    yield* Effect.log(`Purging Netlify CDN cache for ${siteSlug ?? siteId ?? 'site'}`)

    const httpClient = yield* HttpClient.HttpClient

    yield* HttpClientRequest.schemaBodyJson(NetlifyPurgeRequestSchema)(
      HttpClientRequest.post(NETLIFY_API_URL).pipe(HttpClientRequest.setHeader('authorization', `Bearer ${token}`)),
      {
        site_id: siteId,
        site_slug: siteSlug,
      },
    ).pipe(
      Effect.andThen(httpClient.pipe(HttpClient.filterStatusOk).execute),
      Effect.mapError(
        (error) =>
          new NetlifyError({
            message: 'Failed to purge Netlify CDN cache',
            reason: 'unknown',
            cause: error,
          }),
      ),
    )

    yield* Effect.log(`Requested Netlify CDN purge for ${siteSlug ?? siteId ?? 'site'}`)
  })

const determineNetlifyConfigCandidates = (homeDirectory: string): readonly string[] => {
  const configPaths = [] as string[]

  const primaryDirectory = resolveOsConfigDirectory(homeDirectory)
  configPaths.push(join(primaryDirectory, 'config.json'))
  configPaths.push(join(homeDirectory, '.netlify', 'config.json'))

  return configPaths
}

const resolveOsConfigDirectory = (homeDirectory: string): string => {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData && appData !== '') {
      return join(appData, 'netlify')
    }
    return join(homeDirectory, 'AppData', 'Roaming', 'netlify')
  }

  if (process.platform === 'darwin') {
    return join(homeDirectory, 'Library', 'Preferences', 'netlify')
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome && xdgConfigHome !== '') {
    return join(xdgConfigHome, 'netlify')
  }

  return join(homeDirectory, '.config', 'netlify')
}

const isFileMissingError = (error: unknown): error is NodeJS.ErrnoException => {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const maybeError = error as NodeJS.ErrnoException
  return maybeError.code === 'ENOENT' || maybeError.code === 'ENOTDIR'
}
