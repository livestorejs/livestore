import { readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { isNotUndefined } from '@livestore/utils'
import { CurrentWorkingDirectory, cmdText } from '@livestore/utils-dev/node'
import { Command, Effect, Fiber, HttpClient, HttpClientRequest, Schema, Stream } from '@livestore/utils/effect'

export class NetlifyError extends Schema.TaggedError<NetlifyError>()('NetlifyError', {
  reason: Schema.Literal('auth', 'unknown'),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

class FileReadError extends Schema.TaggedError<FileReadError>()('FileReadError', {
  cause: Schema.Defect,
  path: Schema.String,
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

const NetlifySiteListSchema = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))

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
 * Deploy docs using the Netlify CLI.
 *
 * Default mode: split build/deploy
 * - Build happens beforehand via Astro (mono docs build)
 * - Deploy uses config‑driven publish (reads docs/netlify.toml) with --no-build
 * - This ensures Edge Functions are attached without rebuilding
 */
export const deployToNetlify = ({
  site,
  target,
  message,
  debug,
}: {
  site: string
  target: Target
  message?: string
  /** When true, passes --debug to Netlify CLI and increases logging. */
  debug?: boolean
}) =>
  Effect.gen(function* () {
    const cwd = yield* CurrentWorkingDirectory
    const netlifyStatus = yield* cmdText(['bunx', 'netlify-cli', 'status'], { stderr: 'pipe' })

    if (netlifyStatus.includes(NOT_LOGGED_IN_TO_NETLIFY_ERROR_MESSAGE)) {
      return yield* new NetlifyError({ message: 'Not logged in to Netlify', reason: 'auth' })
    }

    // TODO replace pnpm dlx with bunx again once fixed (https://share.cleanshot.com/CKSg1dX9)
    const debugEnabled =
      debug === true || process.env.NETLIFY_CLI_DEBUG === '1' || process.env.NETLIFY_CLI_DEBUG === 'true'

    const resolvedSiteArg = yield* Effect.gen(function* () {
      const explicit = process.env.NETLIFY_SITE_ID
      if (explicit && explicit !== '') return explicit
      return yield* resolveSiteIdViaApi(site)
    })

    yield* Effect.logDebug(`[deploy-to-netlify] Using site argument: ${resolvedSiteArg}`)

    const deployCmd = 'pnpm'
    const deployRest = [
      '--package=netlify-cli',
      'dlx',
      'netlify',
      'deploy',
      // In debug mode, omit --json so we get full build logs in stdout/stderr
      debugEnabled ? undefined : '--json',
      debugEnabled ? '--debug' : undefined,
      '--filter',
      '@local/docs',
      // Split flow default: do not run Netlify build; rely on netlify.toml publish
      '--no-build',
      `--site=${resolvedSiteArg}`,
      message ? `--message=${message}` : undefined,
      target._tag === 'prod' ? '--prod' : target._tag === 'alias' ? `--alias=${target.alias}` : undefined,
    ].filter(isNotUndefined)

    /** Capture both stdout and stderr so CLI errors are never silently lost */
    const { stdout: rawOutput, stderr: rawStderr } = yield* Effect.scoped(
      Effect.gen(function* () {
        const proc = yield* Effect.acquireRelease(
          Command.make(deployCmd, ...deployRest).pipe(
            Command.stdout('pipe'),
            Command.stderr('pipe'),
            Command.workingDirectory(cwd),
            Command.env({
              CI: '1',
              NETLIFY_CONFIG: join(cwd, 'netlify.toml'),
            }),
            Command.start,
          ),
          (p) =>
            p.isRunning.pipe(
              Effect.flatMap((running) => (running ? p.kill().pipe(Effect.catchAll(() => Effect.void)) : Effect.void)),
              Effect.ignore,
            ),
        )

        const stdoutFiber = yield* proc.stdout.pipe(
          Stream.decodeText('utf8'),
          Stream.runFold('', (acc, chunk) => acc + chunk),
          Effect.forkScoped,
        )

        const stderrFiber = yield* proc.stderr.pipe(
          Stream.decodeText('utf8'),
          Stream.runFold('', (acc, chunk) => acc + chunk),
          Effect.forkScoped,
        )

        yield* proc.exitCode

        const stdout = yield* Fiber.join(stdoutFiber)
        const stderr = yield* Fiber.join(stderrFiber)

        return { stdout, stderr }
      }),
    )

    yield* Effect.logDebug(`[deploy-to-netlify] Deploy raw stdout for ${site}: ${rawOutput}`)
    if (rawStderr.trim().length > 0) {
      yield* Effect.logWarning(`[deploy-to-netlify] Deploy stderr for ${site}: ${rawStderr}`)
    }

    const result = yield* Schema.decode(Schema.parseJson(NetlifyDeployResultSchema))(rawOutput).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError(
            `[deploy-to-netlify] Failed to decode Netlify deploy JSON for ${site}; raw output follows:`,
          )
          yield* Effect.logError(rawOutput)
          if (rawStderr.trim().length > 0) {
            yield* Effect.logError(`[deploy-to-netlify] stderr: ${rawStderr}`)
          }
          return yield* new NetlifyError({
            message: `Failed to decode Netlify deploy result${rawStderr.trim().length > 0 ? `: ${rawStderr.trim()}` : ''}`,
            reason: 'unknown',
            cause: { error, raw: rawOutput, stderr: rawStderr },
          })
        }),
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
      catch: (error) => new FileReadError({ cause: error, path: candidate }),
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
      cause: readError.cause,
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

/** Resolve a Netlify site name to its site ID via the HTTP API (avoids CLI stdout corruption) */
const resolveSiteIdViaApi = Effect.fn('resolveSiteIdViaApi')(function* (siteName: string) {
  const token = yield* resolveNetlifyAuthToken
  const httpClient = yield* HttpClient.HttpClient

  const sites = yield* httpClient
    .pipe(HttpClient.filterStatusOk)
    .execute(
      HttpClientRequest.get('https://api.netlify.com/api/v1/sites?per_page=100').pipe(
        HttpClientRequest.setHeader('authorization', `Bearer ${token}`),
      ),
    )
    .pipe(
      Effect.andThen((res) => res.json),
      Effect.andThen(Schema.decodeUnknown(NetlifySiteListSchema)),
      Effect.mapError(
        (cause) =>
          new NetlifyError({
            message: `Failed to resolve Netlify site "${siteName}" via API`,
            reason: 'unknown',
            cause,
          }),
      ),
    )

  const match = sites.find((s) => s.name === siteName)
  return match ? match.id : siteName
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

const isFileMissingError = (error: FileReadError): boolean => {
  const cause = error.cause
  if (typeof cause !== 'object' || cause === null) {
    return false
  }

  const maybeError = cause as NodeJS.ErrnoException
  return maybeError.code === 'ENOENT' || maybeError.code === 'ENOTDIR'
}
