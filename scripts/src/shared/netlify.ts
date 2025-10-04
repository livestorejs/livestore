import os from 'node:os'
import { join } from 'node:path'

import { Effect, FileSystem, HttpClient, HttpClientRequest, Schema } from '@livestore/utils/effect'
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

export const deployToNetlify = ({
  site,
  dir,
  target,
  cwd,
  filter,
}: {
  site: string
  dir: string
  target: Target
  cwd: string
  filter?: string
}) =>
  Effect.gen(function* () {
    const netlifyStatus = yield* cmdText(['bunx', 'netlify-cli', 'status'], { cwd, stderr: 'pipe' })

    if (netlifyStatus.includes(NOT_LOGGED_IN_TO_NETLIFY_ERROR_MESSAGE)) {
      return yield* new NetlifyError({ message: 'Not logged in to Netlify', reason: 'auth' })
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
        `--dir=${dir}`,
        `--site=${site}`,
        filter ? `--filter=${filter}` : undefined,
        // Either use `--prod` or `--alias`
        target._tag === 'prod' ? '--prod' : target._tag === 'alias' ? `--alias=${target.alias}` : undefined,
      ],
      {
        cwd,
        env: { CI: '1' }, // Prevent netlify from using TTY
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

  const configPath = join(homeDirectory, '.config', 'netlify', 'config.json')
  const fileSystem = yield* FileSystem.FileSystem
  const configContent = yield* fileSystem.readFileString(configPath).pipe(
    Effect.mapError(
      (error) =>
        new NetlifyError({
          message: `Failed to read Netlify CLI config at ${configPath}`,
          reason: 'auth',
          cause: error,
        }),
    ),
  )

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
